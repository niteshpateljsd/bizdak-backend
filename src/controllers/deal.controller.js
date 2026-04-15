const prisma = require('../utils/prisma');
const { translateDealById } = require('../jobs/translate.job');

const PAGE_SIZE = 20;

async function list(req, res, next) {
  try {
    const where = {
      isActive: true,
      OR: [
        { endDate: { gte: new Date() } }, // has an end date that hasn't passed
        { endDate: null },                // no end date — open-ended deal
      ],
    };
    if (req.query.cityId)  where.cityId  = req.query.cityId;
    if (req.query.storeId) where.storeId = req.query.storeId;

    if (req.query.tag) {
      // Find the tag and all its children slugs
      const tag = await prisma.tag.findUnique({
        where: { slug: req.query.tag },
        include: { children: { select: { slug: true } } },
      });
      if (tag) {
        const slugs = [tag.slug, ...(tag.children?.map((c) => c.slug) || [])];
        where.tags = { some: { tag: { slug: { in: slugs } } } };
      } else {
        where.tags = { some: { tag: { slug: req.query.tag } } };
      }
    }

    // Cursor-based pagination
    // ?cursor=<lastId> returns the next page after that record
    const limit  = Math.min(parseInt(req.query.limit || PAGE_SIZE, 10), 100);
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
    const { tags = [], ...dealData } = req.body;

    const deal = await prisma.deal.create({
      data: {
        ...dealData,
        tags: {
          create: tags.map((tagId) => ({ tag: { connect: { id: tagId } } })),
        },
      },
      include: { tags: { include: { tag: true } } },
    });

    // Translate immediately — await so French is ready before response
    await translateDealById(deal.id).catch(() => {});

    // Fetch updated deal with translations included
    const translated = await prisma.deal.findUnique({
      where: { id: deal.id },
      include: { tags: { include: { tag: true } } },
    });

    res.status(201).json(formatDeal(translated || deal));
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { tags, ...dealData } = req.body;

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

    // Re-translate immediately if content changed
    const contentChanged = dealData.title !== undefined || dealData.description !== undefined;
    if (contentChanged) await translateDealById(deal.id, true).catch(() => {});

    // Return deal with fresh translations
    const translated = await prisma.deal.findUnique({
      where: { id: deal.id },
      include: { tags: { include: { tag: true } } },
    });

    res.json(formatDeal(translated || deal));
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await prisma.deal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}

// Flatten DealTag join into plain tag objects
function formatDeal(deal) {
  return { ...deal, tags: deal.tags.map((dt) => dt.tag) };
}

module.exports = { list, get, recordView, create, update, remove };
