const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { runExpiryJob } = require('../jobs/expireDeals.job');
const { backfillTranslations } = require('../jobs/translate.job');

// All admin routes require authentication
router.use(authenticate);

// POST /api/admin/run-expiry — manually trigger deal expiry
router.post('/run-expiry', async (req, res, next) => {
  try {
    const result = await runExpiryJob();
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/admin/backfill-translations — fire-and-forget
// Responds immediately with a jobId. Poll /api/admin/backfill-status/:jobId for result.
const _backfillStatus = {};
const BACKFILL_TTL_MS = 60 * 60 * 1000; // prune entries older than 1 hour
function pruneBackfillStatus() {
  const cutoff = Date.now() - BACKFILL_TTL_MS;
  for (const [jobId, s] of Object.entries(_backfillStatus)) {
    if (new Date(s.startedAt).getTime() < cutoff) delete _backfillStatus[jobId];
  }
}
router.post('/backfill-translations', async (req, res) => {
  pruneBackfillStatus(); // clean up old jobs before adding a new one
  const jobId = Date.now().toString(36);
  _backfillStatus[jobId] = { status: 'running', startedAt: new Date().toISOString() };
  res.json({ message: 'Backfill started', jobId, poll: `/api/admin/backfill-status/${jobId}` });
  backfillTranslations()
    .then((result) => {
      _backfillStatus[jobId] = { status: 'done', completedAt: new Date().toISOString(), ...result };
    })
    .catch((err) => {
      _backfillStatus[jobId] = { status: 'error', error: err.message };
    });
});

// GET /api/admin/backfill-status/:jobId
router.get('/backfill-status/:jobId', (req, res) => {
  const s = _backfillStatus[req.params.jobId];
  if (!s) return res.status(404).json({ error: 'Job not found.' });
  res.json(s);
});

module.exports = router;
