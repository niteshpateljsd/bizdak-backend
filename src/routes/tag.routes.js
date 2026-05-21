const router = require('express').Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/tag.controller');

// Public
router.get('/', ctrl.list);

// Admin
router.post(
  '/',
  authenticate,
  [
    body('name').notEmpty().withMessage('Tag name required.'),
    body('slug').notEmpty().isSlug().withMessage('Slug must be a valid slug.'),
    body('parentId').optional({ nullable: true }).isUUID().withMessage('parentId must be a UUID.'),
    validate,
  ],
  ctrl.create
);

router.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID(),
    body('name').optional().notEmpty().withMessage('Name cannot be empty.'),
    // slug is intentionally excluded — changing slug breaks FCM topic subscriptions
    validate,
  ],
  ctrl.update
);

router.get('/:id/count', authenticate, [param('id').isUUID(), validate], ctrl.countTagData);

router.delete(
  '/:id',
  authenticate,
  [param('id').isUUID(), validate],
  ctrl.remove
);

module.exports = router;
