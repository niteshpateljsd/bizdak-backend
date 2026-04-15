const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { ingest, getEventStats } = require('../controllers/event.controller');

const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many event pings.' },
});

const VALID_TYPES = [
  'app_open', 'deal_view', 'store_view', 'geofence_trigger',
  'notification_tap', 'video_play', 'city_switch', 'search',
  'confirmed_visit',
];

// Public — no auth, fire-and-forget from mobile
router.post(
  '/',
  eventLimiter,
  [
    body('type').isIn(VALID_TYPES),
    body('citySlug').optional().isString().isLength({ max: 60 }),
    body('dealId').optional().isUUID(),
    body('storeId').optional().isUUID(),
    body('campaignId').optional().isUUID(),
    body('deviceId').optional().isUUID(),
    body('durationSeconds').optional().isInt({ min: 0, max: 86400 }),
    body('hourOfDay').optional().isInt({ min: 0, max: 23 }),
    validate,
  ],
  ingest
);

// Admin only — aggregated stats
router.get('/stats', authenticate, getEventStats);

module.exports = router;
