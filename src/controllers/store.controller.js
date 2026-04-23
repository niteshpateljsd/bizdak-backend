const prisma = require('../utils/prisma');
const { translateStoreById } = require('../jobs/translate.job');
const { deleteAsset, extractPublicId } = require('../utils/cloudinary');

const PAGE_SIZE = 20;

async function list(req, res, next) {
  try {
    const where = {};
    if (req.query.cityId) where.cityId = req.query.cityId;

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE));
    const cursor = req.query.cursor;

    const stores = await prisma.store.findMany({
      where,
      include: {
        city: { select: { id: true, name: true, slug: true } },
        _count: {
          select: {
            deals: {
              where: {
                isActive: true,
                AND: [
                  { OR: [{ endDate:   { gte: new Date() } }, { endDate:   null }] },
                  { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] },
                ],
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      take:   limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasNextPage = stores.length > limit;
    const items       = hasNextPage ? stores.slice(0, limit) : stores;
    const nextCursor  = hasNextPage ? items[items.length - 1].id : null;

    // Flatten _count.deals to a top-level dealCount for the admin dashboard
    const mapped = items.map(({ _count, ...s }) => ({ ...s, dealCount: _count.deals }));
    res.json({ items: mapped, nextCursor, hasNextPage, count: mapped.length });
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        city: true,
        deals: {
          where: {
            isActive: true,
            AND: [
              { OR: [{ endDate:   { gte: new Date() } }, { endDate:   null }] },
              { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] },
            ],
          },
          include: { tags: { include: { tag: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    res.json({
      ...store,
      deals: store.deals.map((d) => ({ ...d, tags: d.tags.map((dt) => dt.tag) })),
    });
  } catch (err) { next(err); }
}

// Lightweight analytics ping – no user identity attached
async function recordView(req, res, next) {
  try {
    await prisma.store.update({
      where: { id: req.params.id },
      data: { viewCount: { increment: 1 } },
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const {
      name, description, address, lat, lng,
      phone, website, imageUrl, videoUrl, videoThumbnailUrl, cityId,
    } = req.body;

    // Verify city exists before creating store — gives a clean 404 instead of Prisma FK error
    const city = await prisma.city.findUnique({ where: { id: cityId } });
    if (!city) return res.status(404).json({ error: 'City not found.' });

    // Null-coerce optional string fields — prevent storing empty strings
    const store = await prisma.store.create({
      data: { name, description, address, lat, lng,
              phone: phone?.trim() || null,
              website: website?.trim() || null,
              imageUrl, videoUrl, videoThumbnailUrl, cityId },
    });
    // Trigger translation in background — don't block the response
    translateStoreById(store.id).catch(() => {});
    res.status(201).json(store);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const {
      name, description, address, lat, lng,
      phone, website, imageUrl, videoUrl, videoThumbnailUrl,
    } = req.body;
    const data = {};
    if (name              !== undefined) data.name              = name;
    if (description       !== undefined) data.description       = description;
    if (address           !== undefined) data.address           = address;
    if (lat               !== undefined) data.lat               = lat;
    if (lng               !== undefined) data.lng               = lng;
    if (phone             !== undefined) data.phone             = phone?.trim() || null;
    if (website           !== undefined) data.website           = website?.trim() || null;
    if (imageUrl          !== undefined) data.imageUrl          = imageUrl;
    if (videoUrl          !== undefined) data.videoUrl          = videoUrl;
    if (videoThumbnailUrl !== undefined) data.videoThumbnailUrl = videoThumbnailUrl;

    // Fetch current store — also checks existence before wasting update query on invalid ID
    const existing = await prisma.store.findUnique({
      where: { id: req.params.id },
      select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true, name: true, description: true },
    });
    if (!existing) return res.status(404).json({ error: 'Store not found.' });

    const store = await prisma.store.update({
      where: { id: req.params.id },
      data,
    });

    // Clean up replaced Cloudinary assets — fire-and-forget
    setImmediate(async () => {
      try {
        const jobs = [];
        if (imageUrl          !== undefined && existing?.imageUrl          && existing.imageUrl          !== imageUrl)
          jobs.push(deleteAsset(extractPublicId(existing.imageUrl), 'image'));
        if (videoUrl          !== undefined && existing?.videoUrl          && existing.videoUrl          !== videoUrl)
          jobs.push(deleteAsset(extractPublicId(existing.videoUrl), 'video'));
        if (videoThumbnailUrl !== undefined && existing?.videoThumbnailUrl && existing.videoThumbnailUrl !== videoThumbnailUrl)
          jobs.push(deleteAsset(extractPublicId(existing.videoThumbnailUrl), 'image'));
        if (jobs.length) await Promise.allSettled(jobs);
      } catch (err) {
        console.warn('[Cloudinary] Asset cleanup failed after store update:', err.message);
      }
    });

    // Re-translate only if value actually changed — avoids overwriting manual corrections
    const nameChanged        = name        !== undefined && name        !== existing.name;
    const descriptionChanged = description !== undefined && description !== existing.description;
    // Re-translate fire-and-forget — translation completes after response, no re-fetch needed
    if (nameChanged || descriptionChanged) translateStoreById(store.id, true).catch(() => {});

    res.json(store);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    // Fetch store and all its deals before deletion so we can clean up Cloudinary assets
    const store = await prisma.store.findUnique({
      where: { id: req.params.id },
      select: {
        imageUrl: true,
        videoUrl: true,
        videoThumbnailUrl: true,
        deals: {
          select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true },
        },
      },
    });

    if (!store) return res.status(404).json({ error: 'Store not found.' });

    // Delete from DB first — cascade removes all deals and DealTag rows
    await prisma.store.delete({ where: { id: req.params.id } });

    // Clean up Cloudinary assets after successful DB delete
    // Fire-and-forget — never block or fail the response over asset cleanup
    setImmediate(async () => {
      try {
        const assetJobs = [];

        // Store image, video, and thumbnail
        if (store.imageUrl)          assetJobs.push(deleteAsset(extractPublicId(store.imageUrl), 'image'));
        if (store.videoUrl)          assetJobs.push(deleteAsset(extractPublicId(store.videoUrl), 'video'));
        if (store.videoThumbnailUrl) assetJobs.push(deleteAsset(extractPublicId(store.videoThumbnailUrl), 'image'));

        // All deal images, videos, and thumbnails
        for (const deal of store.deals) {
          if (deal.imageUrl)          assetJobs.push(deleteAsset(extractPublicId(deal.imageUrl), 'image'));
          if (deal.videoUrl)          assetJobs.push(deleteAsset(extractPublicId(deal.videoUrl), 'video'));
          if (deal.videoThumbnailUrl) assetJobs.push(deleteAsset(extractPublicId(deal.videoThumbnailUrl), 'image'));
        }

        await Promise.allSettled(assetJobs);
        console.log(`[Cloudinary] Cleaned ${assetJobs.length} asset(s) for deleted store ${req.params.id}`);
      } catch (err) {
        console.warn('[Cloudinary] Asset cleanup failed after store delete:', err.message);
      }
    });

    res.status(204).end();
  } catch (err) { next(err); }
}

/**
 * GET /api/stores/:id/city
 * Returns the city a store belongs to.
 * Used by the mobile auto-switch to identify the target city from a storeId
 * without fetching every city pack — much faster than the current loop.
 */
async function getCity(req, res, next) {
  try {
    const store = await prisma.store.findUnique({
      where: { id: req.params.id },
      select: { id: true, city: { select: { id: true, name: true, slug: true, lat: true, lng: true } } },
    });
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    res.json(store.city);
  } catch (err) { next(err); }
}

module.exports = { list, get, recordView, create, update, remove, getCity };
