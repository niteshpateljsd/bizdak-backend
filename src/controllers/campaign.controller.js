const prisma = require('../utils/prisma');
const { buildTopic, sendToTopic } = require('../utils/firebase');

async function list(req, res, next) {
  try {
    const where = {};
    if (req.query.cityId) where.cityId = req.query.cityId;

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursor = req.query.cursor;

    const campaigns = await prisma.campaign.findMany({
      where,
      include: {
        city:       { select: { id: true, name: true, slug: true } },
        targetCity: { select: { id: true, name: true, slug: true } },
        store:      { select: { id: true, name: true } },
        deals:      { include: { deal: { select: { id: true, title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasNextPage = campaigns.length > limit;
    const items       = hasNextPage ? campaigns.slice(0, limit) : campaigns;
    const nextCursor  = hasNextPage ? items[items.length - 1].id : null;

    res.json({ items: items.map(formatCampaign), nextCursor, hasNextPage });
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
    const { dealIds = [], ...rawBody } = req.body;

    // Coerce empty string storeId to undefined — frontend may send '' when no store selected
    if (rawBody.storeId === '') rawBody.storeId = undefined;

    // Whitelist allowed campaign fields — prevent mass assignment
    const data = {};
    const allowedFields = ['title', 'body', 'imageUrl', 'type', 'cityId', 'storeId', 'tagSlug'];
    allowedFields.forEach((k) => { if (rawBody[k] !== undefined) data[k] = rawBody[k]; });
    // targetCityId only relevant for CROSS_CITY — strip it for other types
    if (rawBody.type === 'CROSS_CITY' && rawBody.targetCityId) {
      data.targetCityId = rawBody.targetCityId;
    }

    // Validate dealIds are valid UUIDs to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = dealIds.filter((id) => typeof id !== 'string' || !uuidRegex.test(id));
    if (invalidIds.length) {
      return res.status(422).json({ error: 'dealIds must be valid UUIDs.' });
    }

    // Validate CROSS_CITY requires targetCityId
    if (data.type === 'CROSS_CITY' && !data.targetCityId) {
      return res.status(422).json({ error: 'CROSS_CITY campaigns require a targetCityId (audience city).' });
    }

    // Resolve the AUDIENCE city slug for FCM topic
    // For CROSS_CITY: audience = targetCity. For all others: audience = store's city.
    const audienceCityId = data.type === 'CROSS_CITY' ? data.targetCityId : data.cityId;
    const audienceCity = await prisma.city.findUniqueOrThrow({ where: { id: audienceCityId } });

    // Validate storeId and tagSlug in parallel — both are independent of each other
    const [storeCheck, tagCheck] = await Promise.all([
      data.storeId
        ? prisma.store.findFirst({ where: { id: data.storeId, cityId: data.cityId }, select: { id: true } })
        : Promise.resolve(true), // no storeId — skip check
      (data.type === 'INTEREST_BASED' && data.tagSlug)
        ? prisma.tag.findUnique({ where: { slug: data.tagSlug }, select: { id: true } })
        : Promise.resolve(true), // no tagSlug needed — skip check
    ]);

    if (data.storeId && !storeCheck) {
      return res.status(422).json({ error: 'Store does not belong to the specified city.' });
    }
    if (data.type === 'INTEREST_BASED' && data.tagSlug && !tagCheck) {
      return res.status(422).json({ error: `Tag slug '${data.tagSlug}' not found. Check your tags.` });
    }

    const fcmTopic = buildTopic(
      audienceCity.slug,
      data.type === 'INTEREST_BASED' ? data.tagSlug : null
    );

    // Verify all linked deals belong to the campaign city
    if (dealIds.length > 0) {
      const validDeals = await prisma.deal.findMany({
        where: { id: { in: dealIds }, cityId: data.cityId },
        select: { id: true },
      });
      if (validDeals.length !== dealIds.length) {
        return res.status(422).json({ error: 'One or more deals do not belong to the campaign city.' });
      }
    }

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

    // Atomic lock using a unique sentLock field approach:
    // Use updateMany with sentAt: null condition — if count=0, another request already sent it
    const sentAt = new Date();
    const lockResult = await prisma.campaign.updateMany({
      where: { id: req.params.id, sentAt: null },
      data:  { sentAt }, // optimistic — will rollback manually on FCM failure
    });
    if (lockResult.count === 0) {
      const already = await prisma.campaign.findUnique({ where: { id: req.params.id } });
      return res.status(409).json({ error: 'Campaign already sent.', sentAt: already?.sentAt });
    }

    const data = {
      campaignId: campaign.id,
      type:       campaign.type,
      storeCitySlug:  campaign.city.slug,
      targetCitySlug: campaign.targetCity?.slug || campaign.city.slug,
    };
    if (campaign.storeId)      data.storeId = campaign.storeId;
    if (campaign.deals.length) data.dealIds = campaign.deals.map((cd) => cd.deal.id).join(',');
    if (campaign.imageUrl)     data.imageUrl = campaign.imageUrl;

    try {
      await sendToTopic(campaign.fcmTopic, {
        title:    campaign.title,
        body:     campaign.body,
        imageUrl: campaign.imageUrl || null,
        data,
      });
    } catch (fcmErr) {
      // FCM failed — roll back sentAt so admin can retry
      await prisma.campaign.update({
        where: { id: campaign.id },
        data:  { sentAt: null },
      }).catch((rbErr) => {
        console.error(`[Campaign] CRITICAL: FCM failed AND rollback failed for campaign ${campaign.id}. ` +
          `Campaign shows as sent but no notification was delivered. Manual fix required. ` +
          `Rollback error: ${rbErr.message}`);
      }); // best-effort rollback
      throw fcmErr; // propagate to error handler
    }

    res.json({
      message: `Campaign sent to topic "${campaign.fcmTopic}".`,
      sentAt,  // already captured before the atomic lock — no extra DB query needed
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
