const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const authRoutes = require('./routes/auth.routes');
const cityRoutes = require('./routes/city.routes');
const storeRoutes = require('./routes/store.routes');
const dealRoutes = require('./routes/deal.routes');
const tagRoutes = require('./routes/tag.routes');
const campaignRoutes = require('./routes/campaign.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const uploadRoutes    = require('./routes/upload.routes');
const eventRoutes     = require('./routes/event.routes');

// Manual job trigger (admin-only convenience endpoint)
const { authenticate } = require('./middleware/auth.middleware');
const { runExpiryJob } = require('./jobs/expireDeals.job');

const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();

// Compress all responses — cuts city pack JSON by ~70%
app.use(compression());

// Security
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bizdak-api', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/upload',    uploadRoutes);
app.use('/api/events',    eventRoutes);

// Manual expiry trigger — POST /api/admin/run-expiry (admin only)
app.post('/api/admin/run-expiry', authenticate, async (req, res, next) => {
  try {
    const result = await runExpiryJob();
    res.json(result);
  } catch (err) { next(err); }
});

// Backfill translations — POST /api/admin/backfill-translations (admin only)
// Run once after setting DEEPL_API_KEY to translate all existing content.
const { backfillTranslations } = require('./jobs/translate.job');
app.post('/api/admin/backfill-translations', authenticate, async (req, res, next) => {
  try {
    const result = await backfillTranslations();
    res.json({ message: 'Backfill complete', ...result });
  } catch (err) { next(err); }
});

// Error handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
