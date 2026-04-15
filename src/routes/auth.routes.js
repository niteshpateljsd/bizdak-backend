const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { login, me } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required.'),
    body('password').notEmpty().withMessage('Password required.'),
    validate,
  ],
  login
);

router.get('/me', authenticate, me);

module.exports = router;
