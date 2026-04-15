const cron = require('node-cron');
const { runExpiryJob } = require('./expireDeals.job');

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
    await runExpiryJob();
  }, {
    timezone: 'UTC', // use UTC; convert in UI layer if needed
  });

  console.log('[Cron] Deal expiry job scheduled — runs daily at 02:00 UTC');
}

module.exports = { startCronJobs };
