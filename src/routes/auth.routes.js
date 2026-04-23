const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { validate } = require('../middleware/validate.middleware');
const { login, me } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Strict rate limit on login — 10 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failed attempts
});

router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().withMessage('Valid email required.'),
    body('password').notEmpty().withMessage('Password required.'),
    validate,
  ],
  login
);

router.get('/me', authenticate, me);

module.exports = router;
