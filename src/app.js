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
const { backfillTranslations } = require('./jobs/translate.job');

const { notFound, errorHandler } = require('./middleware/error.middleware');
const { versionCheck }           = require('./middleware/version.middleware');
const Sentry                      = require('@sentry/node');
const prisma = require('./utils/prisma'); // needed for /health DB connectivity check

const app = express();

// Trust the reverse proxy (Render, Railway, Heroku all sit behind one)
// Without this, rate limiting sees the proxy IP not the client IP
app.set('trust proxy', 1);

// Sentry request handler — must be first middleware
app.use(Sentry.Handlers.requestHandler());

// Compress all responses — cuts city pack JSON by ~70%
app.use(compression());

// Security headers — disable CSP since this is a pure JSON API (no HTML served)
// All other helmet protections remain active (X-Frame-Options, HSTS, etc.)
app.use(helmet({ contentSecurityPolicy: false }));
// CORS — allow admin dashboard origin and mobile (mobile uses no-cors natively)
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Rate limiting
// Fallback limit for /api/events — the route itself applies a stricter 30/min limiter
// This app-level limiter acts as a second line of defence only
const eventLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
});
// Stricter limit for all other API routes (pack, admin, analytics)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests, please try again later.' },
});
// Tight limit on auth — 10 attempts per 15 min per IP prevents brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: true, // only count failed attempts toward the limit
});
app.use('/api/events', eventLimiter);
app.use('/api/auth',   authLimiter);
// Apply general limiter to all API routes EXCEPT /events (which has its own higher limit)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/events')) return next();
  return limiter(req, res, next);
});

// App version check — returns 426 if client is below MIN_APP_VERSION env var
app.use(versionCheck);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging — 'combined' in production (Apache format), 'dev' locally (coloured)
// morgan does NOT log request bodies by default, only headers/path/status/time
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Health check — also verifies DB connectivity
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'bizdak-api', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', service: 'bizdak-api', error: 'Database unreachable', timestamp: new Date().toISOString() });
  }
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
// Returns immediately with jobId so the 3-min HTTP timeout is never hit,
// even for large datasets (500 deals + stores + tags can take 2–5 min).
// The admin polls /admin/backfill-status/async until status='done'.
let _lastBackfillResult = null;
let _backfillRunning = false; // OT09: prevent concurrent backfills consuming 2x DeepL quota
app.post('/api/admin/backfill-translations', authenticate, async (req, res, next) => {
  try {
    if (_backfillRunning) {
      return res.status(409).json({ error: 'Backfill already in progress — please wait for it to complete.' });
    }
    _backfillRunning = true;
    _lastBackfillResult = null; // reset so status returns 'running' while in progress
    res.json({ message: 'Backfill started', jobId: 'async' });
    // Fire-and-forget after response is flushed — avoids HTTP timeout on large datasets
    setImmediate(async () => {
      try {
        _lastBackfillResult = await backfillTranslations();
      } catch (err) {
        _lastBackfillResult = { error: err.message };
        console.error('[Backfill] Failed:', err.message);
      } finally {
        _backfillRunning = false; // release lock regardless of success/failure
      }
    });
  } catch (err) { next(err); }
});

// Status endpoint — polls while backfill runs in background.
// Returns { status: 'running' } until complete, then { status: 'done', ...result }.
app.get('/api/admin/backfill-status/:jobId', authenticate, (req, res) => {
  if (!_lastBackfillResult) {
    return res.json({ status: 'running' });
  }
  if (_lastBackfillResult.error) {
    return res.json({ status: 'error', error: _lastBackfillResult.error });
  }
  res.json({ status: 'done', ..._lastBackfillResult });
});

// Error handling
app.use(notFound);
// Sentry error handler — must be before our own errorHandler
app.use(Sentry.Handlers.errorHandler());
app.use(errorHandler);

module.exports = app;
