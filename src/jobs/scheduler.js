const cron = require('node-cron');
const { runExpiryJob } = require('./expireDeals.job');
const { backfillTranslations } = require('./translate.job');

/**
 * startCronJobs
 *
 * Registers all scheduled background jobs.
 * Call once from src/index.js after the server starts.
 *
 * Schedule: '0 2 * * *' = every day at 02:00 server time.
 * Change to match your server's timezone if needed.
 * Useful cron expressions:
 *   '0 2 * * *'   — 02:00 daily
 *   '0 * * * *'   — top of every hour (for testing)
 *   '* * * * *'   — every minute (for local dev only)
 */
function startCronJobs() {
  // Nightly deal expiry — 02:00 every day
  cron.schedule('0 2 * * *', async () => {
    const result = await runExpiryJob();
    if (!result.success) {
      console.error('[Cron] Deal expiry job FAILED:', result.error);
    }
  }, {
    timezone: 'UTC', // use UTC; convert in UI layer if needed
  });

  console.log('[Cron] Deal expiry job scheduled — runs daily at 02:00 UTC');

  // Nightly translation retry — 03:00 UTC
  // Self-heals content that failed to translate due to DeepL downtime or a missing key
  cron.schedule('0 3 * * *', async () => {
    if (!process.env.DEEPL_API_KEY) return;
    try {
      const result = await backfillTranslations();
      if (result.deals > 0 || result.stores > 0) {
        console.log(`[Cron] Translation retry: ${result.deals} deals, ${result.stores} stores`);
      }
    } catch (err) {
      console.warn('[Cron] Translation retry failed:', err.message);
    }
  }, { timezone: 'UTC' });

  if (!process.env.DEEPL_API_KEY) {
    console.warn('[Cron] DEEPL_API_KEY not set — translation retry cron will be a no-op. Set the key to enable auto-translation.');
  }
  console.log('[Cron] Translation retry scheduled — 03:00 UTC');
}

module.exports = { startCronJobs };
