const router = require('express').Router();
const { query } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/analytics.controller');

// All analytics routes require admin auth
router.use(authenticate);

router.get(
  '/overview',
  [query('cityId').optional().isUUID(), validate],
  ctrl.overview
);

router.get(
  '/top-deals',
  [
    query('cityId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    validate,
  ],
  ctrl.topDeals
);

router.get(
  '/top-stores',
  [
    query('cityId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    validate,
  ],
  ctrl.topStores
);

router.get('/campaigns', ctrl.campaignStats);

module.exports = router;
