const prisma  = require('../utils/prisma');
const { randomUUID } = require('crypto');
const { translateDealById } = require('../jobs/translate.job');
const { deleteAsset, extractPublicId } = require('../utils/cloudinary');

const PAGE_SIZE = 20;

async function list(req, res, next) {
  try {
    // ?includeInactive=true — admin only; bypasses active/date filter to show all deals
    // req.admin is set by authenticate middleware; not present on public requests
    const includeAll = !!req.admin && req.query.includeInactive === 'true';
    const where = includeAll ? {} : {
      isActive: true,
      AND: [
        { OR: [{ endDate:   { gte: new Date() } }, { endDate:   null }] }, // not expired
        { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] }, // already started
      ],
    };
    if (req.query.cityId)  where.cityId  = req.query.cityId;
    if (req.query.storeId) where.storeId = req.query.storeId;

    if (req.query.tag) {
      // Single query: match deals tagged with this slug OR any child tag with this parent slug
      // This avoids a separate tag lookup round-trip
      where.tags = {
        some: {
          tag: {
            OR: [
              { slug: req.query.tag },                         // exact match
              { parent: { slug: req.query.tag } },             // child of this tag
            ],
          },
        },
      };
    }

    // Cursor-based pagination
    // ?cursor=<lastId> returns the next page after that record
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE));
    const cursor = req.query.cursor; // ID of last item from previous page

    const deals = await prisma.deal.findMany({
      where,
      include: {
        tags:  { include: { tag: true } },
        store: { select: { id: true, name: true, lat: true, lng: true } },
        city:  { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take:   limit + 1,                          // fetch one extra to know if next page exists
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasNextPage = deals.length > limit;
    const items       = hasNextPage ? deals.slice(0, limit) : deals;
    const nextCursor  = hasNextPage ? items[items.length - 1].id : null;

    res.json({
      items:      items.map(formatDeal),
      nextCursor,
      hasNextPage,
      count:      items.length,
    });
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        tags: { include: { tag: true } },
        store: true,
        city: true,
      },
    });
    res.json(formatDeal(deal));
  } catch (err) { next(err); }
}

// Lightweight analytics ping – no user identity attached
async function recordView(req, res, next) {
  try {
    await prisma.deal.update({
      where: { id: req.params.id },
      data: { viewCount: { increment: 1 } },
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { tags = [], ...rawBody } = req.body;

    // Whitelist allowed deal fields — prevent setting viewCount, isActive etc on create
    const dealData = {};
    const allowed = ['title', 'description', 'imageUrl', 'videoUrl', 'videoThumbnailUrl',
                     'originalPrice', 'discountedPrice', 'discountPercent', 'videoDuration',
                     'startDate', 'endDate', 'isActive', 'cityId', 'storeId'];
    allowed.forEach((k) => { if (rawBody[k] !== undefined) dealData[k] = rawBody[k]; });

    // Validate all tagIds are UUIDs before attempting DB connect
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const badTags = tags.filter((id) => typeof id !== 'string' || !uuidRe.test(id));
    if (badTags.length) {
      return res.status(422).json({ error: 'All tag IDs must be valid UUIDs.' });
    }

    // Verify all tag IDs exist — prevents cryptic P2003 FK error
    if (tags.length > 0) {
      const foundTags = await prisma.tag.findMany({ where: { id: { in: tags } }, select: { id: true } });
      if (foundTags.length !== tags.length) {
        return res.status(422).json({ error: 'One or more tag IDs not found.' });
      }
    }

    // Verify store belongs to the given city — prevents cross-city data corruption
    if (dealData.storeId && dealData.cityId) {
      const store = await prisma.store.findFirst({
        where: { id: dealData.storeId, cityId: dealData.cityId },
      });
      if (!store) {
        return res.status(422).json({ error: 'Store does not belong to the specified city.' });
      }
    }

    const deal = await prisma.deal.create({
      data: {
        ...dealData,
        tags: {
          create: tags.map((tagId) => ({ tag: { connect: { id: tagId } } })),
        },
      },
      include: { tags: { include: { tag: true } } },
    });

    // Trigger translation in background — don't block the response
    // French content will appear on next city pack refresh (mobile caches for 5min)
    translateDealById(deal.id).catch(() => {});

    res.status(201).json(formatDeal(deal));
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { tags, ...rawData } = req.body;

    // Whitelist updatable fields — prevent mass assignment of viewCount, cityId, storeId etc.
    const dealData = {};
    const allowed = ['title', 'description', 'imageUrl', 'videoUrl', 'videoThumbnailUrl',
                     'originalPrice', 'discountedPrice', 'discountPercent', 'videoDuration',
                     'startDate', 'endDate', 'isActive'];
    allowed.forEach((k) => { if (rawData[k] !== undefined) dealData[k] = rawData[k]; });

    // Validate tag IDs are UUIDs if provided
    if (tags !== undefined) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const badTags = tags.filter((id) => typeof id !== 'string' || !uuidRe.test(id));
      if (badTags.length) {
        return res.status(422).json({ error: 'All tag IDs must be valid UUIDs.' });
      }
      // Verify all tag IDs exist — prevents cryptic P2003 FK error
      if (tags.length > 0) {
        const foundTags = await prisma.tag.findMany({ where: { id: { in: tags } }, select: { id: true } });
        if (foundTags.length !== tags.length) {
          return res.status(422).json({ error: 'One or more tag IDs not found.' });
        }
      }
    }

    // Fetch current deal — also gives us assets for Cloudinary cleanup and validates existence
    const existing = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true, title: true, description: true },
    });
    if (!existing) return res.status(404).json({ error: 'Deal not found.' });

    const deal = await prisma.$transaction(async (tx) => {
      if (tags !== undefined) {
        await tx.dealTag.deleteMany({ where: { dealId: req.params.id } });
        await tx.dealTag.createMany({
          data: tags.map((tagId) => ({ dealId: req.params.id, tagId })),
        });
      }
      return tx.deal.update({
        where: { id: req.params.id },
        data: dealData,
        include: { tags: { include: { tag: true } } },
      });
    });

    // Clean up replaced Cloudinary assets — fire-and-forget
    setImmediate(async () => {
      try {
        const jobs = [];
        if (dealData.imageUrl          !== undefined && existing?.imageUrl          && existing.imageUrl          !== dealData.imageUrl)
          jobs.push(deleteAsset(extractPublicId(existing.imageUrl), 'image'));
        if (dealData.videoUrl          !== undefined && existing?.videoUrl          && existing.videoUrl          !== dealData.videoUrl)
          jobs.push(deleteAsset(extractPublicId(existing.videoUrl), 'video'));
        if (dealData.videoThumbnailUrl !== undefined && existing?.videoThumbnailUrl && existing.videoThumbnailUrl !== dealData.videoThumbnailUrl)
          jobs.push(deleteAsset(extractPublicId(existing.videoThumbnailUrl), 'image'));
        if (jobs.length) await Promise.allSettled(jobs);
      } catch (err) {
        console.warn('[Cloudinary] Asset cleanup failed after deal update:', err.message);
      }
    });

    // Re-translate if content actually changed — fire-and-forget (DeepL is async)
    // Do NOT re-fetch after firing — translation completes after the HTTP response.
    // Mobile picks up new FR content on next city pack refresh (5-min cache).
    const titleChanged       = dealData.title       !== undefined && dealData.title       !== existing.title;
    const descriptionChanged = dealData.description !== undefined && dealData.description !== existing.description;
    if (titleChanged || descriptionChanged) translateDealById(deal.id, true).catch(() => {});

    res.json(formatDeal(deal));
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    // Fetch assets before deletion for Cloudinary cleanup
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true, title: true, description: true },
    });

    if (!deal) return res.status(404).json({ error: 'Deal not found.' });

    await prisma.deal.delete({ where: { id: req.params.id } });

    // Clean up Cloudinary assets — fire-and-forget
    setImmediate(async () => {
      try {
        const jobs = [];
        if (deal.imageUrl)          jobs.push(deleteAsset(extractPublicId(deal.imageUrl), 'image'));
        if (deal.videoUrl)          jobs.push(deleteAsset(extractPublicId(deal.videoUrl), 'video'));
        if (deal.videoThumbnailUrl) jobs.push(deleteAsset(extractPublicId(deal.videoThumbnailUrl), 'image'));
        if (jobs.length) {
          await Promise.allSettled(jobs);
          console.log(`[Cloudinary] Cleaned ${jobs.length} asset(s) for deleted deal ${req.params.id}`);
        }
      } catch (err) {
        console.warn('[Cloudinary] Asset cleanup failed after deal delete:', err.message);
      }
    });

    res.status(204).end();
  } catch (err) { next(err); }
}

// Flatten DealTag join into plain tag objects
function formatDeal(deal) {
  return { ...deal, tags: deal.tags.map((dt) => dt.tag) };
}


/**
 * POST /api/deals/bulk
 * Create the same deal across multiple stores in one action.
 * Body: same as POST /api/deals but with storeIds: string[] instead of storeId: string.
 * Returns: { created: N, deals: [...] }
 *
 * Each store gets its own independent deal record — they can be edited individually
 * after creation. The bulk action is purely a creation convenience.
 */
async function createBulk(req, res, next) {
  try {
    const { tags = [], storeIds = [], ...rawBody } = req.body;

    if (!Array.isArray(storeIds) || storeIds.length === 0) {
      return res.status(422).json({ error: 'storeIds must be a non-empty array.' });
    }

    // cityId is required for bulk create — validate early before any DB work
    if (!rawBody.cityId) {
      return res.status(422).json({ error: 'cityId is required for bulk deal creation.' });
    }

    // Whitelist shared deal fields (same as single create, minus storeId)
    const dealData = {};
    const allowed = ['title', 'description', 'imageUrl', 'videoUrl', 'videoThumbnailUrl',
                     'originalPrice', 'discountedPrice', 'discountPercent', 'videoDuration',
                     'startDate', 'endDate', 'isActive', 'cityId'];
    allowed.forEach((k) => { if (rawBody[k] !== undefined) dealData[k] = rawBody[k]; });

    // Validate tag UUIDs
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const badTags = tags.filter((id) => !uuidRe.test(id));
    if (badTags.length) return res.status(422).json({ error: 'All tag IDs must be valid UUIDs.' });

    if (tags.length > 0) {
      const found = await prisma.tag.findMany({ where: { id: { in: tags } }, select: { id: true } });
      if (found.length !== tags.length) return res.status(422).json({ error: 'One or more tag IDs not found.' });
    }

    // Validate all storeIds exist and belong to the given city
    if (dealData.cityId) {
      const validStores = await prisma.store.findMany({
        where: { id: { in: storeIds }, cityId: dealData.cityId },
        select: { id: true },
      });
      if (validStores.length !== storeIds.length) {
        return res.status(422).json({ error: 'One or more stores not found in the specified city.' });
      }
    }

    // All deals in a bulk create share the same groupId — enables group editing later
    const groupId = randomUUID();

    // Create one deal per store inside a single transaction
    const deals = await prisma.$transaction(
      storeIds.map((storeId) =>
        prisma.deal.create({
          data: {
            ...dealData,
            storeId,
            groupId,
            tags: { create: tags.map((tagId) => ({ tag: { connect: { id: tagId } } })) },
          },
          include: { tags: { include: { tag: true } } },
        })
      )
    );

    // Trigger background translation for each deal
    deals.forEach((d) => translateDealById(d.id).catch(() => {}));

    res.status(201).json({ created: deals.length, deals: deals.map(formatDeal) });
  } catch (err) { next(err); }
}


/**
 * PUT /api/deals/:id/group
 * Update a subset of deals that share the same groupId.
 * Body: same update fields as PUT /api/deals/:id, plus storeIds: string[] (which stores to update).
 * If storeIds is omitted, updates ALL deals in the group.
 *
 * Returns: { updated: N, deals: [...] }
 */
async function updateGroup(req, res, next) {
  try {
    const { storeIds, tags, ...rawBody } = req.body;

    // Fetch the source deal to get its groupId
    const sourceDeal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { id: true, groupId: true, cityId: true },
    });
    if (!sourceDeal) return res.status(404).json({ error: 'Deal not found.' });
    if (!sourceDeal.groupId) {
      return res.status(422).json({ error: 'This deal was not created as part of a bulk group.' });
    }

    // Whitelist updatable fields (same as single update, minus storeId/cityId)
    const dealData = {};
    const allowed = ['title', 'description', 'imageUrl', 'videoUrl', 'videoThumbnailUrl',
                     'originalPrice', 'discountedPrice', 'discountPercent', 'videoDuration',
                     'startDate', 'endDate', 'isActive'];
    allowed.forEach((k) => { if (rawBody[k] !== undefined) dealData[k] = rawBody[k]; });

    // Find all deals in this group
    const groupDeals = await prisma.deal.findMany({
      where: { groupId: sourceDeal.groupId },
      select: { id: true, storeId: true },
    });

    // Filter to only the requested stores (if storeIds provided)
    const targetDeals = storeIds && storeIds.length > 0
      ? groupDeals.filter((d) => storeIds.includes(d.storeId))
      : groupDeals;

    if (targetDeals.length === 0) {
      return res.status(422).json({ error: 'No matching deals found for the specified stores.' });
    }

    // Validate tags if provided
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (tags !== undefined) {
      const badTags = (tags || []).filter((id) => !uuidRe.test(id));
      if (badTags.length) return res.status(422).json({ error: 'All tag IDs must be valid UUIDs.' });
      if (tags.length > 0) {
        const found = await prisma.tag.findMany({ where: { id: { in: tags } }, select: { id: true } });
        if (found.length !== tags.length) return res.status(422).json({ error: 'One or more tag IDs not found.' });
      }
    }

    // Update all target deals in a single flat transaction
    // Nested transactions are not supported in Prisma — all ops must be flat
    const updated = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const d of targetDeals) {
        if (tags !== undefined) {
          // Replace tags then update deal fields in the same tx
          await tx.dealTag.deleteMany({ where: { dealId: d.id } });
          const result = await tx.deal.update({
            where: { id: d.id },
            data: {
              ...dealData,
              tags: { create: tags.map((tagId) => ({ tag: { connect: { id: tagId } } })) },
            },
            include: { tags: { include: { tag: true } } },
          });
          results.push(result);
        } else {
          const result = await tx.deal.update({
            where: { id: d.id },
            data: dealData,
            include: { tags: { include: { tag: true } } },
          });
          results.push(result);
        }
      }
      return results;
    });

    // Only retranslate if text content actually changed — avoids wasting DeepL credits
    // on endDate / discountPercent / isActive updates
    const titleChanged       = rawBody.title       !== undefined;
    const descriptionChanged = rawBody.description !== undefined;
    if (titleChanged || descriptionChanged) {
      updated.forEach((d) => translateDealById(d.id, true).catch(() => {}));
    }

    res.json({ updated: updated.length, deals: updated.map(formatDeal) });
  } catch (err) { next(err); }
}

/**
 * GET /api/deals/:id/group
 * Returns all deals that share the same groupId as the given deal.
 * Used by the admin deal form to show which stores are in a bulk group.
 */
async function getGroup(req, res, next) {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { groupId: true },
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    if (!deal.groupId) return res.json([]);

    const group = await prisma.deal.findMany({
      where: { groupId: deal.groupId },
      include: {
        store: { select: { id: true, name: true, address: true } },
        tags:  { include: { tag: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(group);
  } catch (err) { next(err); }
}

module.exports = { list, get, recordView, create, createBulk, update, updateGroup, getGroup, remove };
