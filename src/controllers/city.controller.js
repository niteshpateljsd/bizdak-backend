const prisma = require('../utils/prisma');
const { deleteAsset, extractPublicId } = require('../utils/cloudinary');

async function list(req, res, next) {
  try {
    const cities = await prisma.city.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(cities);
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const city = await prisma.city.findUniqueOrThrow({
      where: { slug: req.params.slug },
    });
    res.json(city);
  } catch (err) { next(err); }
}

/**
 * City pack – lightweight payload the mobile app downloads on first visit.
 * Returns stores + active deals (with tags) for the city.
 * No user data involved.
 */
async function getCityPack(req, res, next) {
  try {
    const city = await prisma.city.findUniqueOrThrow({
      where: { slug: req.params.slug },
    });

    const [stores, deals, tags] = await Promise.all([
      prisma.store.findMany({
        where: { cityId: city.id },
        select: {
          id: true, name: true, nameFr: true, description: true,
          descriptionFr: true, address: true, lat: true, lng: true,
          phone: true, website: true, imageUrl: true,
          videoUrl: true, videoThumbnailUrl: true,
          // Note: videoDuration belongs to Deal, not Store — removed from store select
        },
        orderBy: { name: 'asc' },
      }),
      prisma.deal.findMany({
        where: {
          cityId: city.id,
          isActive: true,
          // AND both date conditions — deal must be active now (not expired, not future)
          AND: [
            { OR: [{ endDate: { gte: new Date() } }, { endDate: null }] },
            { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] },
          ],
        },
        take: 500, // safety cap — cities with >500 active deals should paginate via /api/deals
        include: {
          tags: {
            include: {
              tag: {
                include: {
                  parent: { select: { id: true, name: true, slug: true } },
                },
              },
            },
          },
          store: { select: { id: true, name: true, nameFr: true, description: true, descriptionFr: true, lat: true, lng: true, address: true, phone: true, website: true, imageUrl: true, videoUrl: true, videoThumbnailUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tag.findMany({
        include: { children: { select: { id: true, name: true, slug: true } } },
        where: { parentId: null },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Warn if the deal cap was hit — admin should know if deals are being truncated
    if (deals.length === 500) {
      console.warn(`[CityPack] ${city.slug}: 500-deal cap reached — some deals may not appear in mobile app.`);
    }

    // private: mobile caches locally; no CDN/proxy caching — data changes frequently
    // Note: deals are already ordered by createdAt desc from Prisma — no JS re-sort needed
    const capReached = deals.length === 500;
    res.set('Cache-Control', 'private, max-age=300');
    res.json({
      city,
      stores,
      tags,
      deals: deals.map((d) => ({
        ...d,
        tags: d.tags.map((dt) => dt.tag),
      })),
      generatedAt: new Date().toISOString(),
      capReached, // true when 500-deal limit hit — admin should be notified
    });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const name    = req.body.name?.trim();
    const country = req.body.country?.trim();
    const { lat, lng } = req.body;
    const slug = req.body.slug?.toLowerCase().trim(); // normalise — FCM topics are lowercase
    if (!slug) return res.status(422).json({ error: 'slug is required.' });
    const city = await prisma.city.create({ data: { name, slug, country, lat, lng } });
    res.status(201).json(city);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { name, country, lat, lng } = req.body;
    // slug is intentionally excluded from updates — changing it orphans all FCM subscriptions
    const data = {};
    if (name    !== undefined) data.name    = name;
    if (country !== undefined) data.country = country;
    if (lat     !== undefined) data.lat     = lat;
    if (lng     !== undefined) data.lng     = lng;
    const city = await prisma.city.update({ where: { id: req.params.id }, data });
    res.json(city);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    // Count dependent records — return 409 if city has data, unless ?force=true
    const [storeCount, dealCount] = await Promise.all([
      prisma.store.count({ where: { cityId: req.params.id } }),
      prisma.deal.count({ where: { cityId: req.params.id } }),
    ]);

    if ((storeCount > 0 || dealCount > 0) && req.query.force !== 'true') {
      return res.status(409).json({
        error: 'City has existing data. Pass ?force=true to delete everything.',
        stores: storeCount,
        deals: dealCount,
      });
    }

    // Fetch all Cloudinary assets before cascade-delete wipes them from DB
    const [cityStores, cityDeals, cityCampaigns] = await Promise.all([
      prisma.store.findMany({
        where: { cityId: req.params.id },
        select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true },
      }),
      prisma.deal.findMany({
        where: { cityId: req.params.id },
        select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true },
      }),
      prisma.campaign.findMany({
        where: { cityId: req.params.id },
        select: { imageUrl: true },
      }),
    ]);

    await prisma.city.delete({ where: { id: req.params.id } });

    // Clean up Cloudinary assets — fire-and-forget after DB delete
    setImmediate(async () => {
      try {
        const jobs = [];
        for (const s of cityStores) {
          if (s.imageUrl)          jobs.push(deleteAsset(extractPublicId(s.imageUrl), 'image'));
          if (s.videoUrl)          jobs.push(deleteAsset(extractPublicId(s.videoUrl), 'video'));
          if (s.videoThumbnailUrl) jobs.push(deleteAsset(extractPublicId(s.videoThumbnailUrl), 'image'));
        }
        for (const d of cityDeals) {
          if (d.imageUrl)          jobs.push(deleteAsset(extractPublicId(d.imageUrl), 'image'));
          if (d.videoUrl)          jobs.push(deleteAsset(extractPublicId(d.videoUrl), 'video'));
          if (d.videoThumbnailUrl) jobs.push(deleteAsset(extractPublicId(d.videoThumbnailUrl), 'image'));
        }
        for (const c of cityCampaigns) {
          if (c.imageUrl) jobs.push(deleteAsset(extractPublicId(c.imageUrl), 'image'));
        }
        if (jobs.length) {
          await Promise.allSettled(jobs);
          console.log(`[Cloudinary] Cleaned ${jobs.length} asset(s) for deleted city ${req.params.id}`);
        }
      } catch (err) {
        console.warn('[Cloudinary] Asset cleanup failed after city delete:', err.message);
      }
    });

    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, get, getCityPack, create, update, remove };
