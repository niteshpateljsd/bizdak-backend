const prisma = require('../utils/prisma');
const { translateText } = require('../utils/translate');

// Silently translate a tag name to French — catches errors so tag creation
// never fails just because DeepL is unavailable
async function translateTagName(name) {
  try {
    const nameFr = await translateText(name, 'FR', 'EN');
    return nameFr || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/tags
 * Returns all tags as a flat list with parent info included.
 * The admin and mobile can reconstruct the tree from parentId.
 *
 * Also supports ?nested=true to return a tree structure:
 *   [{ id, name, slug, children: [...] }]
 */
async function list(req, res, next) {
  try {
    const allTags = await prisma.tag.findMany({
      include: {
        children: { orderBy: { name: 'asc' } },
        parent:   { select: { id: true, name: true, slug: true } },
      },
      orderBy: { name: 'asc' },
    });

    if (req.query.nested === 'true') {
      // Return tree — top-level tags with children nested
      const roots = allTags.filter((t) => !t.parentId);
      res.json(roots);
    } else {
      // Flat list with parent info
      res.json(allTags);
    }
  } catch (err) { next(err); }
}

/**
 * POST /api/tags
 * Create a tag. Pass parentId to make it a sub-tag.
 * Body: { name, slug, parentId? }
 */
async function create(req, res, next) {
  try {
    const name     = req.body.name?.trim();
    const slug     = req.body.slug?.toLowerCase().trim(); // normalise — used in FCM topics
    const parentId = req.body.parentId;

    // Validate parentId exists if provided
    if (parentId) {
      const parent = await prisma.tag.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(422).json({ error: 'Parent tag not found.' });
      // Only allow one level of nesting — sub-tags cannot have children
      if (parent.parentId) {
        return res.status(422).json({ error: 'Sub-tags cannot have their own sub-tags (max 2 levels).' });
      }
    }

    // Translate name to French — fire-and-forget friendly (never blocks tag creation)
    const nameFr = await translateTagName(name);

    const tag = await prisma.tag.create({
      data: { name, nameFr, slug, parentId: parentId || null },
      include: {
        parent:   { select: { id: true, name: true, slug: true } },
        children: true,
      },
    });

    res.status(201).json(tag);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A tag with this name or slug already exists.' });
    }
    next(err);
  }
}

/**
 * PUT /api/tags/:id
 * Update a tag's name and/or slug.
 * parentId cannot be changed — create a new tag instead.
 * Body: { name?, slug? }
 */
async function update(req, res, next) {
  try {
    const { name } = req.body;
    // slug is intentionally excluded from update — changing slug breaks FCM topic subscriptions
    const data = {};
    if (name !== undefined) {
      data.name   = name.trim();
      // Re-translate whenever the English name changes
      data.nameFr = await translateTagName(name.trim());
    }

    if (!Object.keys(data).length) {
      return res.status(422).json({ error: 'Provide at least one field to update (name or slug).' });
    }

    const tag = await prisma.tag.update({
      where: { id: req.params.id },
      data,
      include: {
        parent:   { select: { id: true, name: true, slug: true } },
        children: { orderBy: { name: 'asc' } },
      },
    });

    res.json(tag);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A tag with this name or slug already exists.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Tag not found.' });
    }
    next(err);
  }
}

/**
 * DELETE /api/tags/:id
 * Deletes a tag. Sub-tags of this tag have their parentId set to null (promoted to root).
 */
async function remove(req, res, next) {
  try {
    // Count deals AND child tags that will be affected
    const [dealCount, childCount] = await Promise.all([
      prisma.dealTag.count({ where: { tagId: req.params.id } }),
      prisma.tag.count({ where: { parentId: req.params.id } }),
    ]);

    if ((dealCount > 0 || childCount > 0) && req.query.force !== 'true') {
      return res.status(409).json({
        error: [
          dealCount > 0 ? `used by ${dealCount} deal(s)` : null,
          childCount > 0 ? `has ${childCount} sub-tag(s) that will become root-level tags` : null,
        ].filter(Boolean).join(' and ') + '. Pass ?force=true to proceed.',
        dealCount,
        childCount,
      });
    }

    await prisma.tag.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}


async function countTagData(req, res, next) {
  try {
    const [dealCount, childCount] = await Promise.all([
      prisma.dealTag.count({ where: { tagId: req.params.id } }),
      prisma.tag.count({ where: { parentId: req.params.id } }),
    ]);
    res.json({ deals: dealCount, children: childCount });
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove, countTagData };
