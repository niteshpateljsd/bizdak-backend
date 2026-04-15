const router = require('express').Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/city.controller');

// Public
router.get('/', ctrl.list);
router.get('/:slug', ctrl.get);
router.get('/:slug/pack', ctrl.getCityPack);

// Admin
router.post(
  '/',
  authenticate,
  [
    body('name').notEmpty(),
    body('slug').notEmpty().isSlug(),
    body('country').notEmpty(),
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
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
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    validate,
  ],
  ctrl.update
);

router.delete('/:id', authenticate, [param('id').isUUID(), validate], ctrl.remove);

module.exports = router;
