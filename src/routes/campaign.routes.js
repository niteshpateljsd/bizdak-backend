const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/campaign.controller');

// All campaign routes require admin auth
router.use(authenticate);

router.get('/', [query('cityId').optional().isUUID(), validate], ctrl.list);
router.get('/:id', [param('id').isUUID(), validate], ctrl.get);

router.post(
  '/',
  [
    body('title').notEmpty().isLength({ max: 100 }).withMessage('Title required, max 100 chars.'),
    body('body').notEmpty().isLength({ max: 300 }).withMessage('Notification body required, max 300 chars (FCM limit).'),
    body('type')
      .isIn(['CITY_WIDE', 'INTEREST_BASED', 'STORE_SPECIFIC', 'CROSS_CITY'])
      .withMessage('type must be CITY_WIDE, INTEREST_BASED, STORE_SPECIFIC, or CROSS_CITY.'),
    body('cityId').isUUID().withMessage('Valid cityId required.'),
    body('storeId').optional().isUUID(),
    body('targetCityId').optional().isUUID().withMessage('targetCityId must be a valid UUID.'),
    body('tagSlug')
      .if(body('type').equals('INTEREST_BASED'))
      .notEmpty()
      .withMessage('tagSlug is required for INTEREST_BASED campaigns.'),
    body('imageUrl').optional({ nullable: true }).isURL({ require_protocol: true })
      .withMessage('imageUrl must be a valid URL starting with https://'),
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
