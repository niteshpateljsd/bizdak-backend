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

    // Verify store exists
    await prisma.store.findUniqueOrThrow({ where: { id } });

    const deals = await prisma.deal.findMany({
      where: {
        storeId: id,
        isActive: true,
        endDate: { gte: new Date() },
        createdAt: { gt: sinceDate },
      },
      select: {
        id: true,
        title: true,
        discountPercent: true,
        createdAt: true,
        tags: { select: { tag: { select: { name: true, slug: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      storeId: id,
      since: sinceDate.toISOString(),
      count: deals.length,
      hasNew: deals.length > 0,
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        discountPercent: d.discountPercent,
        tags: d.tags.map((dt) => dt.tag),
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getNewDeals };
