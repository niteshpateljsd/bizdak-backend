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
    body('title').notEmpty(),
    body('description').notEmpty(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('cityId').isUUID(),
    body('storeId').isUUID(),
    body('tags').optional().isArray(),
    validate,
  ],
  ctrl.create
);

router.put(
  '/:id',
  authenticate,
  [param('id').isUUID(), validate],
  ctrl.update
);

router.delete(
  '/:id',
  authenticate,
  [param('id').isUUID(), validate],
  ctrl.remove
);

module.exports = router;
