const prisma = require('../utils/prisma');

/**
 * High-level platform overview.
 * All metrics are aggregate counts — no user-level data stored or returned.
 */
async function overview(req, res, next) {
  try {
    const where = {};
    if (req.query.cityId) where.cityId = req.query.cityId;

    const [
      totalStores,
      totalDeals,
      activeDeals,
      totalCampaigns,
      sentCampaigns,
      totalStoreViews,
      totalDealViews,
    ] = await Promise.all([
      prisma.store.count({ where }),
      prisma.deal.count({ where }),
      prisma.deal.count({ where: {
        ...where,
        isActive: true,
        AND: [
          { OR: [{ endDate:   { gte: new Date() } }, { endDate:   null }] },
          { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] },
        ],
      }}),
      prisma.campaign.count({ where }),
      prisma.campaign.count({ where: { ...where, sentAt: { not: null } } }),
      prisma.store.aggregate({ where, _sum: { viewCount: true } }),
      prisma.deal.aggregate({ where, _sum: { viewCount: true } }),
    ]);

    res.json({
      stores: { total: totalStores, totalViews: totalStoreViews._sum.viewCount ?? 0 },
      deals: { total: totalDeals, active: activeDeals, totalViews: totalDealViews._sum.viewCount ?? 0 },
      campaigns: { total: totalCampaigns, sent: sentCampaigns },
    });
  } catch (err) { next(err); }
}

async function topDeals(req, res, next) {
  try {
    const where = {
      isActive: true,
      AND: [
        { OR: [{ endDate:   { gte: new Date() } }, { endDate:   null }] },
        { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] },
      ],
    };
    if (req.query.cityId) where.cityId = req.query.cityId;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '10', 10) || 10));

    const deals = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        title: true,
        viewCount: true,
        store: { select: { id: true, name: true } },
        city: { select: { id: true, name: true } },
      },
      orderBy: { viewCount: 'desc' },
      take: limit,
    });

    res.json(deals);
  } catch (err) { next(err); }
}

async function topStores(req, res, next) {
  try {
    const where = {};
    if (req.query.cityId) where.cityId = req.query.cityId;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '10', 10) || 10));

    const stores = await prisma.store.findMany({
      where,
      select: {
        id: true,
        name: true,
        viewCount: true,
        city: { select: { id: true, name: true } },
      },
      orderBy: { viewCount: 'desc' },
      take: limit,
    });

    res.json(stores);
  } catch (err) { next(err); }
}

async function campaignStats(req, res, next) {
  try {
    const where = {};
    if (req.query.cityId) where.cityId = req.query.cityId;

    const [campaigns, tapRows] = await Promise.all([
      prisma.campaign.findMany({
        where,
        take: 100,
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          fcmTopic: true,
          sentAt: true,
          createdAt: true,
          imageUrl: true,
          tagSlug: true,
          storeId: true,
          city:       { select: { id: true, name: true, slug: true } },
          targetCity: { select: { id: true, name: true, slug: true } },
          store:      { select: { id: true, name: true } },
          deals:      { include: { deal: { select: { id: true, title: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Count notification_tap events grouped by campaignId — scoped to the selected date window
      prisma.event.groupBy({
        by: ['campaignId'],
        where: { ...where, type: 'notification_tap', campaignId: { not: null } },
        _count: { id: true },
      }),
    ]);

    // Build a lookup map: campaignId → tap count
    const tapMap = Object.fromEntries(
      tapRows.map((r) => [r.campaignId, r._count.id])
    );

    const result = campaigns.map((c) => ({
      ...c,
      taps: tapMap[c.id] ?? 0,
      deals: c.deals.map((cd) => cd.deal),
    }));

    res.json(result);
  } catch (err) { next(err); }
}

async function campaignDetail(req, res, next) {
  try {
    const { id } = req.params;

    const [campaign, tapCount, dailyTaps] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id },
        select: {
          id: true, title: true, body: true, type: true,
          fcmTopic: true, sentAt: true, createdAt: true,
          imageUrl: true, tagSlug: true, storeId: true,
          city:       { select: { id: true, name: true, slug: true } },
          targetCity: { select: { id: true, name: true, slug: true } },
          store:      { select: { id: true, name: true } },
          deals:      { include: { deal: { select: { id: true, title: true } } } },
        },
      }),
      // Total taps for this campaign
      prisma.event.count({
        where: { type: 'notification_tap', campaignId: id },
      }),
      // Daily taps — bounded to campaign lifespan to avoid full-table scan
      // Lower bound: 1 day before send (catches any pre-send test taps)
      // Upper bound: NOW() — only complete days
      prisma.$queryRaw`
        SELECT DATE_TRUNC('day', timestamp) AS day, COUNT(*)::int AS taps
        FROM events
        WHERE type = 'notification_tap'
          AND "campaignId" = ${id}
          AND timestamp >= (SELECT COALESCE("sentAt", "createdAt") - INTERVAL '1 day' FROM campaigns WHERE id = ${id})
          AND timestamp <= NOW()
        GROUP BY DATE_TRUNC('day', timestamp)
        ORDER BY day ASC
      `,
    ]);

    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    res.json({
      ...campaign,
      deals: campaign.deals.map((cd) => cd.deal),
      taps: tapCount,
      dailyTaps: dailyTaps.map((r) => ({
        day: r.day,
        taps: Number(r.taps),
      })),
    });
  } catch (err) { next(err); }
}

module.exports = { overview, topDeals, topStores, campaignStats, campaignDetail };
