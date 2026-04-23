const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/deal.controller');

// Public
router.get(
  '/',
  [
    query('cityId').optional().isUUID(),
    query('storeId').optional().isUUID(),
    query('cursor').optional().isUUID(),
    query('tag').optional().isString(),
    query('includeInactive').optional().isBoolean(),
    validate,
  ],
  ctrl.list
);
router.get('/:id', [param('id').isUUID(), validate], ctrl.get);
router.post('/:id/view', [param('id').isUUID(), validate], ctrl.recordView);

// Admin

// Bulk create — same deal across multiple stores
router.post(
  '/bulk',
  authenticate,
  [
    body('title').notEmpty(),
    body('description').notEmpty(),
    body('cityId').isUUID(),
    body('storeIds').isArray({ min: 1 }).withMessage('storeIds must be a non-empty array'),
    body('storeIds.*').isUUID().withMessage('Each storeId must be a valid UUID'),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).custom((endDate, { req }) => {
      if (endDate && req.body.startDate && endDate <= req.body.startDate) {
        throw new Error('endDate must be after startDate.');
      }
      return true;
    }),
    body('discountPercent').optional({ nullable: true }).isInt({ min: 0, max: 100 }),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 })
      .custom((discountedPrice, { req }) => {
        if (discountedPrice != null && req.body.originalPrice != null && discountedPrice >= req.body.originalPrice) {
          throw new Error('discountedPrice must be less than originalPrice.');
        }
        return true;
      }),
    body('videoDuration').optional({ nullable: true }).isInt({ min: 0 }),
    body('tags').optional().isArray(),
    validate,
  ],
  ctrl.createBulk
);

router.post(
  '/',
  authenticate,
  [
    body('title').notEmpty(),
    body('description').notEmpty(),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).custom((endDate, { req }) => {
      if (endDate && req.body.startDate && endDate <= req.body.startDate) {
        throw new Error('endDate must be after startDate.');
      }
      return true;
    }),
    body('cityId').isUUID(),
    body('storeId').isUUID(),
    body('tags').optional().isArray(),
    body('discountPercent').optional({ nullable: true }).isInt({ min: 0, max: 100 }).withMessage('discountPercent must be between 0 and 100'),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('originalPrice must be positive'),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('discountedPrice must be positive')
      .custom((discountedPrice, { req }) => {
        if (discountedPrice != null && req.body.originalPrice != null && discountedPrice >= req.body.originalPrice) {
          throw new Error('discountedPrice must be less than originalPrice.');
        }
        return true;
      }),
    body('videoDuration').optional({ nullable: true }).isInt({ min: 0 }).withMessage('videoDuration must be a non-negative integer (seconds)'),
    validate,
  ],
  ctrl.create
);


// Update a subset of deals in the same bulk group
router.put(
  '/:id/group',
  authenticate,
  [
    param('id').isUUID(),
    body('storeIds').optional().isArray(),
    body('storeIds.*').optional().isUUID(),
    body('title').optional().notEmpty(),
    body('description').optional().notEmpty(),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('discountPercent').optional({ nullable: true }).isInt({ min: 0, max: 100 }),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 })
      .custom((discountedPrice, { req }) => {
        if (discountedPrice != null && req.body.originalPrice != null && discountedPrice >= req.body.originalPrice) {
          throw new Error('discountedPrice must be less than originalPrice.');
        }
        return true;
      }),
    body('videoDuration').optional({ nullable: true }).isInt({ min: 0 }),
    body('tags').optional().isArray(),
    validate,
  ],
  ctrl.updateGroup
);

// GET group members — returns all deals sharing the same groupId
router.get(
  '/:id/group',
  authenticate,
  [param('id').isUUID(), validate],
  ctrl.getGroup
);

router.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID(),
    body('title').optional().notEmpty(),
    body('description').optional().notEmpty(),
    body('startDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('endDate').optional({ nullable: true }).custom((endDate, { req }) => {
      if (endDate && req.body.startDate && endDate <= req.body.startDate) {
        throw new Error('endDate must be after startDate.');
      }
      return true;
    }),
    body('discountPercent').optional({ nullable: true }).isInt({ min: 0, max: 100 }),
    body('originalPrice').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountedPrice').optional({ nullable: true }).isFloat({ min: 0 })
      .custom((discountedPrice, { req }) => {
        if (discountedPrice != null && req.body.originalPrice != null && discountedPrice >= req.body.originalPrice) {
          throw new Error('discountedPrice must be less than originalPrice.');
        }
        return true;
      }),
    body('videoDuration').optional({ nullable: true }).isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
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

module.exports = router;
