const prisma = require('../utils/prisma');

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
          videoUrl: true, videoThumbnailUrl: true, videoDuration: true,
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
          store: { select: { id: true, name: true, nameFr: true, description: true, descriptionFr: true, lat: true, lng: true, address: true, phone: true, website: true, imageUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tag.findMany({
        select: {
          id: true, name: true, nameFr: true, slug: true,
          children: { select: { id: true, name: true, nameFr: true, slug: true } },
        },
        where: { parentId: null },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Sort by newest first — all returned deals are already active (filtered above)
    // so the active/expired branch is dead code; createdAt desc is all we need
    const sortedDeals = [...deals].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    // private: mobile caches locally; no CDN/proxy caching — data changes frequently
    res.set('Cache-Control', 'private, max-age=300');
    // IQ30: resize Cloudinary images for mobile — 750px max width is sufficient
    // for any phone screen (max ~430px × 2x retina = 860px needed at most).
    // Reduces pack image download by ~60-70% vs serving full 1200px.
    const mobileImg = (url) => {
      if (!url || !url.includes('res.cloudinary.com')) return url;
      return url.replace('/upload/', '/upload/w_750,f_auto,q_auto/');
    };

    res.json({
      city: {
        ...city,
      },
      stores: stores.map((s) => ({ ...s, imageUrl: mobileImg(s.imageUrl) })),
      tags,
      deals: sortedDeals.map((d) => ({
        ...d,
        imageUrl:          mobileImg(d.imageUrl),
        videoThumbnailUrl: mobileImg(d.videoThumbnailUrl),
        // Strip the 'parent' field from deal tags — mobile doesn't use it
        // and it adds ~30-50 bytes per tag unnecessarily to every pack download.
        tags: d.tags.map((dt) => {
          const { parent: _parent, ...tag } = dt.tag;
          return tag;
        }),
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const name    = req.body.name?.trim();
    const country = req.body.country?.trim();
    const { lat, lng } = req.body;
    const slug = req.body.slug?.toLowerCase().trim(); // normalise — FCM topics are lowercase
    if (!name)    return res.status(422).json({ error: 'name is required.' });
    if (!country) return res.status(422).json({ error: 'country is required.' });
    if (!slug)    return res.status(422).json({ error: 'slug is required.' });
    const city = await prisma.city.create({ data: { name, slug, country, lat, lng } });
    res.status(201).json(city);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { lat, lng } = req.body;
    const name    = req.body.name    !== undefined ? req.body.name?.trim()    : undefined;
    const country = req.body.country !== undefined ? req.body.country?.trim() : undefined;
    // slug is intentionally excluded from update — changing slug breaks FCM topic subscriptions
    // The admin UI shows it as immutable; the API enforces it here too.
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

    // Collect all Cloudinary assets before cascade delete removes the DB rows
    const [stores, deals] = await Promise.all([
      prisma.store.findMany({
        where: { cityId: req.params.id },
        select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true },
      }),
      prisma.deal.findMany({
        where: { cityId: req.params.id },
        select: { imageUrl: true, videoUrl: true, videoThumbnailUrl: true },
      }),
    ]);

    await prisma.city.delete({ where: { id: req.params.id } });
    res.status(204).end();

    // Clean up Cloudinary assets — fire-and-forget after response is sent
    setImmediate(async () => {
      try {
        const { deleteAsset, extractPublicId } = require('../utils/cloudinary');
        const jobs = [];
        for (const s of stores) {
          if (s.imageUrl)          jobs.push(deleteAsset(extractPublicId(s.imageUrl), 'image'));
          if (s.videoUrl)          jobs.push(deleteAsset(extractPublicId(s.videoUrl), 'video'));
          if (s.videoThumbnailUrl) jobs.push(deleteAsset(extractPublicId(s.videoThumbnailUrl), 'image'));
        }
        for (const d of deals) {
          if (d.imageUrl)          jobs.push(deleteAsset(extractPublicId(d.imageUrl), 'image'));
          if (d.videoUrl)          jobs.push(deleteAsset(extractPublicId(d.videoUrl), 'video'));
          if (d.videoThumbnailUrl) jobs.push(deleteAsset(extractPublicId(d.videoThumbnailUrl), 'image'));
        }
        if (jobs.length) {
          await Promise.allSettled(jobs);
          console.log(`[Cloudinary] Cleaned ${jobs.length} asset(s) for deleted city ${req.params.id}`);
        }
      } catch (err) {
        console.warn('[Cloudinary] Asset cleanup failed after city delete:', err.message);
      }
    });
  } catch (err) { next(err); }
}


async function countCityData(req, res, next) {
  try {
    const [stores, deals] = await Promise.all([
      prisma.store.count({ where: { cityId: req.params.id } }),
      prisma.deal.count({   where: { cityId: req.params.id } }),
    ]);
    res.json({ stores, deals });
  } catch (err) { next(err); }
}

module.exports = { list, get, getCityPack, create, update, remove, countCityData };
