const prisma = require('../utils/prisma');

const VALID_TYPES = [
  'app_open', 'deal_view', 'store_view', 'geofence_trigger',
  'notification_tap', 'video_play', 'city_switch', 'search',
  'confirmed_visit',
];

/**
 * POST /api/events
 * Accepts anonymous event pings from the mobile app.
 * No auth required — fire and forget from the client.
 * Rate limited (see routes) to prevent abuse.
 */
async function ingest(req, res, next) {
  try {
    const { type, citySlug, dealId, storeId, campaignId, deviceId, durationSeconds, hourOfDay } = req.body;

    if (!VALID_TYPES.includes(type)) {
      return res.status(422).json({ error: 'Invalid event type.' });
    }

    await prisma.event.create({
      data: {
        type,
        citySlug:        citySlug        || null,
        dealId:          dealId          || null,
        storeId:         storeId         || null,
        campaignId:      campaignId      || null,
        deviceId:        deviceId        || null,
        durationSeconds: durationSeconds ? parseInt(durationSeconds, 10) : null,
        hourOfDay:       hourOfDay       !== undefined ? parseInt(hourOfDay, 10) : null,
      },
    });

    // 204 — no body, keeps response tiny for mobile
    res.status(204).end();
  } catch (err) { next(err); }
}

/**
 * GET /api/analytics/events
 * Admin-only. Returns aggregated event data for the dashboard.
 * Supports ?days=30&citySlug=dakar
 */
async function getEventStats(req, res, next) {
  try {
    const days     = Math.min(parseInt(req.query.days || 30, 10), 365);
    const citySlug = req.query.citySlug || null;
    const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where = { timestamp: { gte: since } };
    if (citySlug) where.citySlug = citySlug;

    // ── Total events by type ─────────────────────────────────
    const byType = await prisma.event.groupBy({
      by: ['type'],
      where,
      _count: { id: true },
    });

    // ── Daily active devices (unique deviceIds per day) ───────
    // Raw query because Prisma groupBy doesn't support date truncation
    const dailyActiveRaw = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('day', timestamp) AS day,
        COUNT(DISTINCT "deviceId") AS devices,
        COUNT(*) AS events
      FROM events
      WHERE timestamp >= ${since}
      ${citySlug ? prisma.$raw`AND "citySlug" = ${citySlug}` : prisma.$raw``}
      GROUP BY DATE_TRUNC('day', timestamp)
      ORDER BY day ASC
    `;

    // ── Events by city ────────────────────────────────────────
    const byCity = await prisma.event.groupBy({
      by: ['citySlug'],
      where: { ...where, citySlug: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // ── Unique devices in period ──────────────────────────────
    const uniqueDevices = await prisma.event.findMany({
      where: { ...where, deviceId: { not: null } },
      distinct: ['deviceId'],
      select: { deviceId: true },
    });

    // ── Top deals by views ────────────────────────────────────
    const topDeals = await prisma.event.groupBy({
      by: ['dealId'],
      where: { ...where, type: 'deal_view', dealId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // ── Top stores by geofence triggers ───────────────────────
    const topStores = await prisma.event.groupBy({
      by: ['storeId'],
      where: { ...where, type: 'geofence_trigger', storeId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // ── Campaign tap rates ────────────────────────────────────
    const campaignTaps = await prisma.event.groupBy({
      by: ['campaignId'],
      where: { ...where, type: 'notification_tap', campaignId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // ── Confirmed store visits (dwell ≥ 3 min) ───────────────
    const visitWhere = { ...where, type: 'confirmed_visit' };

    // Total confirmed visits
    const totalVisits = await prisma.event.count({ where: visitWhere });

    // Visits per store — top 10
    const visitsByStore = await prisma.event.groupBy({
      by: ['storeId'],
      where: { ...visitWhere, storeId: { not: null } },
      _count: { id: true },
      _avg:   { durationSeconds: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // Visits by hour of day (0-23) — peak visit hours
    const visitsByHour = await prisma.event.groupBy({
      by: ['hourOfDay'],
      where: { ...visitWhere, hourOfDay: { not: null } },
      _count: { id: true },
      orderBy: { hourOfDay: 'asc' },
    });

    // Average visit duration across all confirmed visits
    const avgDuration = await prisma.event.aggregate({
      where: { ...visitWhere, durationSeconds: { not: null } },
      _avg: { durationSeconds: true },
    });

    res.json({
      period: { days, since, citySlug },
      summary: {
        totalEvents:    byType.reduce((sum, r) => sum + r._count.id, 0),
        uniqueDevices:  uniqueDevices.length,
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
