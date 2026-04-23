const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/store.controller');
const { getNewDeals } = require('../controllers/newdeals.controller');

// Stricter limiter for the new-deals endpoint.
// Each device checks at most once per geofence entry (every ~15 min due to cache).
// 60 requests per 15 min per IP allows for dense areas without abuse.
const newDealsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  // Skip if IP is not available (e.g. behind a proxy without trust proxy set)
  skip: (req) => !req.ip,
});

// Public
router.get('/', [query('cityId').optional().isUUID(), query('cursor').optional().isUUID(), validate], ctrl.list);
router.get('/:id', [param('id').isUUID(), validate], ctrl.get);
router.post('/:id/view', [param('id').isUUID(), validate], ctrl.recordView);

// Mobile — battery-efficient new deals check (no auth, no user ID)
router.get(
  '/:id/deals/new',
  newDealsLimiter,
  [
    param('id').isUUID(),
    query('since').notEmpty().withMessage('since param required'),
    validate,
  ],
  getNewDeals
);

// Admin
router.post(
  '/',
  authenticate,
  [
    body('name').notEmpty(),
    body('address').notEmpty(),
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
    body('cityId').isUUID(),
    body('website').optional({ nullable: true }).isURL({ require_protocol: true }).withMessage('website must be a valid URL starting with http:// or https://'),
    body('phone').optional({ nullable: true }).isString().isLength({ max: 30 }),
    validate,
  ],
  ctrl.create
);

router.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID(),
    body('name').optional().notEmpty(),
    body('address').optional().notEmpty(),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('website').optional({ nullable: true }).isURL({ require_protocol: true }).withMessage('website must be a valid URL'),
    body('phone').optional({ nullable: true }).isString().isLength({ max: 30 }),
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

// Lightweight city lookup — used by mobile auto-switch (no auth required)
router.get('/:id/city', ctrl.getCity);

module.exports = router;
