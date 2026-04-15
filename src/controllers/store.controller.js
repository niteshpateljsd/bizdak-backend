const prisma = require('../utils/prisma');
const { translateStoreById } = require('../jobs/translate.job');

const PAGE_SIZE = 20;

async function list(req, res, next) {
  try {
    const where = {};
    if (req.query.cityId) where.cityId = req.query.cityId;

    const limit  = Math.min(parseInt(req.query.limit || PAGE_SIZE, 10), 100);
    const cursor = req.query.cursor;

    const stores = await prisma.store.findMany({
      where,
      include: { city: { select: { id: true, name: true, slug: true } } },
      orderBy: { name: 'asc' },
      take:   limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasNextPage = stores.length > limit;
    const items       = hasNextPage ? stores.slice(0, limit) : stores;
    const nextCursor  = hasNextPage ? items[items.length - 1].id : null;

    res.json({ items, nextCursor, hasNextPage, count: items.length });
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        city: true,
        deals: {
          where: { isActive: true, endDate: { gte: new Date() } },
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
    const store = await prisma.store.create({ data: req.body });
    await translateStoreById(store.id).catch(() => {});
    const translated = await prisma.store.findUnique({ where: { id: store.id } });
    res.status(201).json(translated || store);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const store = await prisma.store.update({
      where: { id: req.params.id },
      data: req.body,
    });
    const contentChanged = req.body.name !== undefined || req.body.description !== undefined;
    if (contentChanged) await translateStoreById(store.id, true).catch(() => {});
    const translated = await prisma.store.findUnique({ where: { id: store.id } });
    res.json(translated || store);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await prisma.store.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, get, recordView, create, update, remove };
