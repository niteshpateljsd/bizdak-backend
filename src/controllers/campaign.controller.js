const prisma = require('../utils/prisma');
const { buildTopic, sendToTopic } = require('../utils/firebase');

async function list(req, res, next) {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        city:       { select: { id: true, name: true, slug: true } },
        targetCity: { select: { id: true, name: true, slug: true } },
        store:      { select: { id: true, name: true } },
        deals:      { include: { deal: { select: { id: true, title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns.map(formatCampaign));
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        city:       true,
        targetCity: true,
        store:      true,
        deals:      { include: { deal: true } },
      },
    });
    res.json(formatCampaign(campaign));
  } catch (err) { next(err); }
}

/**
 * Create a campaign.
 *
 * FCM topic logic:
 *   CITY_WIDE       → city_dakar           (audience = store's city)
 *   INTEREST_BASED  → city_dakar_food      (audience = store's city + tag)
 *   STORE_SPECIFIC  → city_dakar           (audience = store's city, store metadata attached)
 *   CROSS_CITY      → city_dakar           (store in Mbour, audience in Dakar — targetCityId required)
 *
 * For CROSS_CITY: targetCityId is the audience city (Dakar).
 * cityId remains the store's city (Mbour) for reference.
 */
async function create(req, res, next) {
  try {
    const { dealIds = [], ...data } = req.body;

    // Validate CROSS_CITY requires targetCityId
    if (data.type === 'CROSS_CITY' && !data.targetCityId) {
      return res.status(422).json({ error: 'CROSS_CITY campaigns require a targetCityId (audience city).' });
    }

    // Resolve the AUDIENCE city slug for FCM topic
    // For CROSS_CITY: audience = targetCity. For all others: audience = store's city.
    const audienceCityId = data.type === 'CROSS_CITY' ? data.targetCityId : data.cityId;
    const audienceCity = await prisma.city.findUniqueOrThrow({ where: { id: audienceCityId } });

    const fcmTopic = buildTopic(
      audienceCity.slug,
      data.type === 'INTEREST_BASED' ? data.tagSlug : null
    );

    const campaign = await prisma.campaign.create({
      data: {
        ...data,
        fcmTopic,
        deals: {
          create: dealIds.map((dealId) => ({ deal: { connect: { id: dealId } } })),
        },
      },
      include: {
        city:       { select: { id: true, name: true, slug: true } },
        targetCity: { select: { id: true, name: true, slug: true } },
        store:      { select: { id: true, name: true } },
        deals:      { include: { deal: { select: { id: true, title: true } } } },
      },
    });

    res.status(201).json(formatCampaign(campaign));
  } catch (err) { next(err); }
}

/**
 * Send a campaign to its FCM topic.
 * Topic was set at creation time — always the AUDIENCE city topic.
 */
async function send(req, res, next) {
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        city:       true,
        targetCity: true,
        deals:      { include: { deal: { select: { id: true, title: true } } } },
      },
    });

    if (campaign.sentAt) {
      return res.status(409).json({ error: 'Campaign already sent.', sentAt: campaign.sentAt });
    }

    const data = {
      campaignId: campaign.id,
      type:       campaign.type,
      // For CROSS_CITY, tell the app which city the store/deal is actually in
      storeCitySlug:  campaign.city.slug,
      targetCitySlug: campaign.targetCity?.slug || campaign.city.slug,
    };
    if (campaign.storeId)      data.storeId  = campaign.storeId;
    if (campaign.deals.length) data.dealIds  = campaign.deals.map((cd) => cd.deal.id).join(',');

    await sendToTopic(campaign.fcmTopic, {
      title: campaign.title,
      body:  campaign.body,
      data,
    });

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data:  { sentAt: new Date() },
    });

    res.json({
      message: `Campaign sent to topic "${campaign.fcmTopic}".`,
      sentAt:  updated.sentAt,
    });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: req.params.id } });
    if (campaign.sentAt) {
      return res.status(409).json({ error: 'Cannot delete a campaign that has already been sent.' });
    }
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}

function formatCampaign(campaign) {
  return { ...campaign, deals: campaign.deals?.map((cd) => cd.deal) ?? [] };
}

module.exports = { list, get, create, send, remove };
