const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { optionalAuthenticate } = require('../middleware/optionalAuth.middleware');
const ctrl = require('../controllers/deal.controller');

// Public
router.get(
  '/',
  optionalAuthenticate, // sets req.admin if valid token present (enables includeInactive for admins)
  [
    query('cityId').optional().isUUID(),
    query('storeId').optional().isUUID(),
    query('cursor').optional().isUUID(),
    query('tag').optional().isString(),
    validate,
  ],
  ctrl.list
);
router.get('/:id', [param('id').isUUID(), validate], ctrl.get);
router.post('/:id/view', [param('id').isUUID(), validate], ctrl.recordView);

// Admin
router.post(
  '/',
  authenticate,
  [
    body('title').trim().notEmpty().withMessage('title cannot be blank'),
    body('description').trim().notEmpty().withMessage('description cannot be blank'),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('cityId').isUUID(),
    body('storeId').isUUID(),
    body('tags').optional().isArray(),
    body('discountPercent').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('discountPercent must be between 0 and 100'),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('originalPrice must be positive'),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('discountedPrice must be positive'),
    validate,
  ],
  ctrl.create
);

router.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID(),
    body('title').optional().trim().notEmpty().withMessage('title cannot be blank'),
    body('description').optional().trim().notEmpty().withMessage('description cannot be blank'),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('discountPercent').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('isActive').optional().isBoolean(),
    body('storeId').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('storeId must be a valid UUID.'),
    body('tags').optional().isArray(),
    validate,
  ],
  ctrl.update
);

router.delete(
  '/:id',
  authenticate,
  [param('id').isUUID(), validate],
  ctrl.remove
);

// ── Bulk / group routes ───────────────────────────────────────
// Express matches by both path and method, so:
//   POST /bulk does NOT conflict with POST / (different literal path)
//   GET /:id/group does NOT conflict with GET /:id (different segment count)
// No special ordering is required here.

/**
 * POST /api/deals/bulk
 * Create the same deal across multiple stores in one action.
 * Body: same as POST / but with storeIds: string[] instead of storeId: string.
 */
router.post(
  '/bulk',
  authenticate,
  [
    body('title').trim().notEmpty().withMessage('title cannot be blank'),
    body('description').trim().notEmpty().withMessage('description cannot be blank'),
    body('storeIds').isArray({ min: 1 }).withMessage('storeIds must be a non-empty array'),
    body('cityId').isUUID(),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('tags').optional().isArray(),
    body('discountPercent').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    validate,
  ],
  ctrl.createBulk
);

/**
 * GET /api/deals/:id/group
 * Returns all deals sharing the same groupId as :id.
 * Used by the admin to show and edit sibling deals from a bulk create.
 */
router.get(
  '/:id/group',
  authenticate,
  [param('id').isUUID(), validate],
  ctrl.getGroup
);

/**
 * PUT /api/deals/:id/group
 * Update all deals in the same bulk group as :id.
 * Body: same updatable fields as PUT /:id, plus optional storeIds to scope the update.
 */
router.put(
  '/:id/group',
  authenticate,
  [
    param('id').isUUID(),
    body('title').optional().trim().notEmpty().withMessage('title cannot be blank'),
    body('description').optional().trim().notEmpty().withMessage('description cannot be blank'),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('discountPercent').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('isActive').optional().isBoolean(),
    body('storeIds').optional().isArray(),
    validate,
  ],
  ctrl.updateGroup
);

module.exports = router;
