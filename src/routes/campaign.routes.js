const router = require('express').Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/campaign.controller');

// All campaign routes require admin auth
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', [param('id').isUUID(), validate], ctrl.get);

router.post(
  '/',
  [
    body('title').notEmpty().withMessage('Title required.'),
    body('body').notEmpty().withMessage('Notification body required.'),
    body('type')
      .isIn(['CITY_WIDE', 'INTEREST_BASED', 'STORE_SPECIFIC'])
      .withMessage('type must be CITY_WIDE, INTEREST_BASED, or STORE_SPECIFIC.'),
    body('cityId').isUUID().withMessage('Valid cityId required.'),
    body('storeId').optional().isUUID(),
    body('tagSlug')
      .if(body('type').equals('INTEREST_BASED'))
      .notEmpty()
      .withMessage('tagSlug is required for INTEREST_BASED campaigns.'),
    body('dealIds').optional().isArray(),
    validate,
  ],
  ctrl.create
);

// Send (fire) a saved campaign to FCM
router.post(
  '/:id/send',
  [param('id').isUUID(), validate],
  ctrl.send
);

router.delete('/:id', [param('id').isUUID(), validate], ctrl.remove);

module.exports = router;
