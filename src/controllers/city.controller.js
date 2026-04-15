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

    const [stores, deals] = await Promise.all([
      prisma.store.findMany({
        where: { cityId: city.id },
        select: {
          id: true, name: true, nameFr: true, description: true,
          address: true, lat: true, lng: true,
          phone: true, website: true, imageUrl: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.deal.findMany({
        where: {
          cityId: city.id,
          isActive: true,
          OR: [
            { endDate: { gte: new Date() } },
            { endDate: null },
          ],
        },
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
          store: { select: { id: true, name: true, lat: true, lng: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Also include full tag tree so mobile knows parent/child relationships
    const tags = await prisma.tag.findMany({
      include: { children: { select: { id: true, name: true, slug: true } } },
      where: { parentId: null },
      orderBy: { name: 'asc' },
    });

    // Sort deals: video deals first, then newest by createdAt
    const sortedDeals = deals.sort((a, b) => {
      const aHasVideo = !!a.videoUrl;
      const bHasVideo = !!b.videoUrl;
      if (aHasVideo !== bHasVideo) return bHasVideo - aHasVideo; // video first
      return new Date(b.createdAt) - new Date(a.createdAt);      // then newest
    });

    res.json({
      city,
      stores,
      tags,
      deals: sortedDeals.map((d) => ({
        ...d,
        tags: d.tags.map((dt) => dt.tag),
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const city = await prisma.city.create({ data: req.body });
    res.status(201).json(city);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const city = await prisma.city.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(city);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await prisma.city.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, get, getCityPack, create, update, remove };
