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
      prisma.deal.count({ where: { ...where, isActive: true, endDate: { gte: new Date() } } }),
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
    const where = { isActive: true };
    if (req.query.cityId) where.cityId = req.query.cityId;
    const limit = parseInt(req.query.limit ?? '10', 10);

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
    const limit = parseInt(req.query.limit ?? '10', 10);

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
    const campaigns = await prisma.campaign.findMany({
      select: {
        id: true,
        title: true,
        type: true,
        fcmTopic: true,
        sentAt: true,
        createdAt: true,
        city: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(campaigns);
  } catch (err) { next(err); }
}

module.exports = { overview, topDeals, topStores, campaignStats };
