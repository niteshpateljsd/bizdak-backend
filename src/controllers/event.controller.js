const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');

// Single source of truth for valid event types — imported by routes for validation
const VALID_TYPES = [
  'app_open', 'deal_view', 'store_view', 'geofence_trigger',
  'notification_tap', 'video_play', 'city_switch', 'search',
  'confirmed_visit',
];
module.exports.VALID_TYPES = VALID_TYPES;

/**
 * POST /api/events
 * Accepts anonymous event pings from the mobile app.
 * No auth required — fire and forget from the client.
 * Rate limited (see routes) to prevent abuse.
 */
async function ingest(req, res, next) {
  try {
    const { type, citySlug, dealId, storeId, campaignId, deviceId, durationSeconds, hourOfDay } = req.body;

    // type validated by express-validator on the route — no controller re-check needed
    await prisma.event.create({
      data: {
        type,
        citySlug:        citySlug?.toLowerCase() || null, // normalise to prevent case mismatch in analytics
        dealId:          dealId          || null,
        storeId:         storeId         || null,
        campaignId:      campaignId      || null,
        deviceId:        deviceId        || null,
        durationSeconds: durationSeconds != null ? Math.max(0, parseInt(durationSeconds, 10) || 0) : null,
        hourOfDay:       hourOfDay       != null ? Math.min(23, Math.max(0, parseInt(hourOfDay, 10) || 0)) : null,
      },
    });

    // 204 — no body, keeps response tiny for mobile
    res.status(204).end();
  } catch (err) { next(err); }
}

/**
 * GET /api/analytics/events
 * Admin-only. Returns aggregated event data for the dashboard.
 * Supports ?days=30&citySlug=dakar  OR  ?from=2025-01-01&to=2025-03-31&citySlug=dakar
 * When from/to are provided they take precedence over days.
 * The daily chart is skipped when the window exceeds 366 days (all-time queries)
 * to avoid scanning the entire events table for a bar chart.
 */
async function getEventStats(req, res, next) {
  try {
    const citySlug = req.query.citySlug?.toLowerCase() || null;

    let since, until;
    if (req.query.from) {
      // Explicit date range — from/to take precedence over days
      since = new Date(req.query.from);
      until = req.query.to ? new Date(req.query.to + 'T23:59:59Z') : new Date();
      if (isNaN(since.getTime()) || isNaN(until.getTime())) {
        return res.status(400).json({ error: 'Invalid from/to date format. Use YYYY-MM-DD.' });
      }
      if (since > until) {
        return res.status(400).json({ error: '"from" must be before "to".' });
      }
    } else {
      // Legacy days param — default 30
      const days = Math.min(Math.max(parseInt(req.query.days || 30, 10), 1), 3650);
      since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      until = new Date();
    }

    // Skip the day-by-day chart when window > 366 days (all-time / multi-year)
    // All aggregate stats still run — just no daily bars to avoid full-table scan
    const windowDays = Math.ceil((until - since) / (1000 * 60 * 60 * 24));
    const skipDailyChart = windowDays > 366;

    const where = { timestamp: { gte: since, lte: until } };
    if (citySlug) where.citySlug = citySlug;

    const visitWhere = { ...where, type: 'confirmed_visit' };

    // Run all queries in parallel — skip daily chart when window is too large
    const [
      byType,
      dailyActiveRaw,
      byCity,
      uniqueDevicesRaw,
      topDeals,
      topStores,
      campaignTaps,
      totalVisits,
      visitsByStore,
      visitsByHour,
      avgDuration,
    ] = await Promise.all([
      // ── Total events by type ─────────────────────────────
      prisma.event.groupBy({
        by: ['type'],
        where,
        _count: { id: true },
      }),

      // ── Daily active devices — skipped when window > 366 days (full-table-scan risk) ──
      skipDailyChart ? Promise.resolve([]) : prisma.$queryRaw`
        SELECT
          DATE_TRUNC('day', timestamp) AS day,
          COUNT(DISTINCT "deviceId") AS devices,
          COUNT(*) AS events
        FROM events
        WHERE timestamp >= ${since} AND timestamp <= ${until}
        ${citySlug ? Prisma.sql`AND "citySlug" = ${citySlug}` : Prisma.empty}
        GROUP BY DATE_TRUNC('day', timestamp)
        ORDER BY day ASC
      `,

      // ── Events by city ────────────────────────────────────
      prisma.event.groupBy({
        by: ['citySlug'],
        where: { ...where, citySlug: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),

      // ── Unique devices (COUNT DISTINCT for memory efficiency) ──
      prisma.$queryRaw`
        SELECT COUNT(DISTINCT "deviceId")::int AS count
        FROM events
        WHERE timestamp >= ${since} AND timestamp <= ${until}
        AND "deviceId" IS NOT NULL
        ${citySlug ? Prisma.sql`AND "citySlug" = ${citySlug}` : Prisma.empty}
      `,

      // ── Top deals by views ────────────────────────────────
      prisma.event.groupBy({
        by: ['dealId'],
        where: { ...where, type: 'deal_view', dealId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // ── Top stores by geofence triggers ──────────────────
      prisma.event.groupBy({
        by: ['storeId'],
        where: { ...where, type: 'geofence_trigger', storeId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // ── Campaign notification tap rates ──────────────────
      prisma.event.groupBy({
        by: ['campaignId'],
        where: { ...where, type: 'notification_tap', campaignId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),

      // ── Total confirmed visits ────────────────────────────
      prisma.event.count({ where: visitWhere }),

      // ── Visits per store — top 10 ─────────────────────────
      prisma.event.groupBy({
        by: ['storeId'],
        where: { ...visitWhere, storeId: { not: null } },
        _count: { id: true },
        _avg:   { durationSeconds: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      // ── Visits by hour of day (peak hours) ───────────────
      prisma.event.groupBy({
        by: ['hourOfDay'],
        where: { ...visitWhere, hourOfDay: { not: null } },
        _count: { id: true },
        orderBy: { hourOfDay: 'asc' },
      }),

      // ── Average visit duration ────────────────────────────
      prisma.event.aggregate({
        where: { ...visitWhere, durationSeconds: { not: null } },
        _avg: { durationSeconds: true },
      }),
    ]);

    const uniqueDeviceCount = Number(uniqueDevicesRaw[0]?.count ?? 0);

    res.json({
      period: { since, until, windowDays, citySlug, skipDailyChart },
      summary: {
        totalEvents:    byType.reduce((sum, r) => sum + r._count.id, 0),
        uniqueDevices:  uniqueDeviceCount,
        confirmedVisits: totalVisits,
        avgVisitMinutes: avgDuration._avg.durationSeconds
          ? Math.round(avgDuration._avg.durationSeconds / 60 * 10) / 10
          : null,
      },
      byType:       byType.map((r) => ({ type: r.type, count: r._count.id })),
      byCity:       byCity.map((r) => ({ citySlug: r.citySlug, count: r._count.id })),
      daily:        dailyActiveRaw.map((r) => ({
        day:     r.day,
        devices: Number(r.devices),
        events:  Number(r.events),
      })),
      topDeals:     topDeals.map((r) => ({ dealId: r.dealId, views: r._count.id })),
      topStores:    topStores.map((r) => ({ storeId: r.storeId, triggers: r._count.id })),
      campaignTaps: campaignTaps.map((r) => ({ campaignId: r.campaignId, taps: r._count.id })),
      storeVisits: {
        byStore: visitsByStore.map((r) => ({
          storeId:        r.storeId,
          visits:         r._count.id,
          avgMinutes:     r._avg.durationSeconds
            ? Math.round(r._avg.durationSeconds / 60 * 10) / 10
            : null,
        })),
        byHour: visitsByHour.map((r) => ({
          hour:   r.hourOfDay,
          visits: r._count.id,
        })),
      },
    });
  } catch (err) { next(err); }
}

module.exports = { ingest, getEventStats };
