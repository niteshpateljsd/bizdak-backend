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
const adminRoutes     = require('./routes/admin.routes');

const { notFound, errorHandler } = require('./middleware/error.middleware');
const prisma = require('./utils/prisma');

const app = express();

// Trust the reverse proxy (Render, Railway, Heroku all sit behind one)
// Without this, rate limiting sees the proxy IP not the client IP
app.set('trust proxy', 1);

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
// Global limiter covers admin/write endpoints.
// City pack downloads are excluded — mobile clients share carrier NAT IPs
// and need higher headroom. Pack has its own limiter below.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.includes('/pack'),
});
app.use('/api', limiter);

// City pack — generous limit for NAT'd mobile networks
const packLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { error: 'Too many city pack requests.' },
});
app.use('/api/cities', packLimiter);

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
app.use('/api/admin',     adminRoutes);


// Error handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
