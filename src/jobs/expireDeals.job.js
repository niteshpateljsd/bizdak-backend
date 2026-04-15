const prisma = require('../utils/prisma');

/**
 * expireDeals
 *
 * Finds all deals where:
 *   - isActive is true
 *   - endDate is in the past
 *
 * Sets isActive = false on all of them in a single batch update.
 * Safe to run multiple times — idempotent.
 *
 * Returns the count of deals deactivated.
 */
async function expireDeals() {
  const now = new Date();

  const result = await prisma.deal.updateMany({
    where: {
      isActive: true,
      endDate: { lt: now },
    },
    data: { isActive: false },
  });

  return result.count;
}

/**
 * runExpiryJob
 *
 * Wrapper with logging. Called by the cron scheduler and
 * also exposed as a manual trigger via POST /api/admin/run-expiry.
 */
async function runExpiryJob() {
  const started = new Date();
  console.log(`[Expiry cron] Starting at ${started.toISOString()}`);

  try {
    const count = await expireDeals();
    const duration = Date.now() - started.getTime();
    console.log(`[Expiry cron] Deactivated ${count} expired deal(s) in ${duration}ms`);
    return { success: true, count, duration };
  } catch (err) {
    console.error('[Expiry cron] Failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { expireDeals, runExpiryJob };
