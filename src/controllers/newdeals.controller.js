const prisma = require('../utils/prisma');

/**
 * GET /api/stores/:id/deals/new?since=ISO_DATE
 *
 * Returns deals for a store created after `since`.
 * Public endpoint — no user identity, no auth required.
 * The mobile app calls this only after passing mute/snooze checks.
 * Response is intentionally minimal to keep payload tiny.
 */
async function getNewDeals(req, res, next) {
  try {
    const { id } = req.params;
    const { since } = req.query;

    if (!since) {
      return res.status(400).json({ error: '`since` query param required (ISO 8601 datetime).' });
    }

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: '`since` must be a valid ISO 8601 datetime.' });
    }

    // Cap lookback to 30 days — prevents accidental full-history scans
    const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
    const cappedSince = new Date(Math.max(sinceDate.getTime(), Date.now() - MAX_LOOKBACK_MS));

    // Verify store exists — findFirst with minimal select is faster than count
    const storeExists = await prisma.store.findFirst({ where: { id }, select: { id: true } });
    if (!storeExists) return res.status(404).json({ error: 'Store not found.' });

    const deals = await prisma.deal.findMany({
      where: {
        storeId: id,
        isActive: true,
        AND: [
          { OR: [{ endDate:   { gte: new Date() } }, { endDate:   null }] },
          { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] },
        ],
        createdAt: { gt: cappedSince },
      },
      select: {
        id: true,
        title: true,
        titleFr: true,
        discountPercent: true,
        imageUrl: true,
        createdAt: true,
        tags: { select: { tag: { select: { name: true, slug: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      storeId: id,
      since:          cappedSince.toISOString(),    // effective lookback (capped at 30 days)
      requestedSince: sinceDate.toISOString(),       // what the client originally sent
      count: deals.length,
      hasNew: deals.length > 0,
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        titleFr: d.titleFr,
        discountPercent: d.discountPercent,
        imageUrl: d.imageUrl || null,  // used by NotificationService for notification image
        tags: d.tags.map((dt) => dt.tag),
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getNewDeals };
