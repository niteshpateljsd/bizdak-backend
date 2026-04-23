require('dotenv').config();

// Validate critical env vars before anything else loads
if (!process.env.DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL env var is not set. Server cannot start.');
  process.exit(1);
}
if (!process.env.ADMIN_EMAIL) {
  console.error('[FATAL] ADMIN_EMAIL env var is not set. Admin login will be impossible.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD) {
  console.error('[FATAL] Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set.');
  process.exit(1);
}

const app = require('./app');
const { startCronJobs } = require('./jobs/scheduler');

const prisma = require('./utils/prisma');
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Bizdak API running on port ${PORT} [${process.env.NODE_ENV}]`);

  // Start scheduled background jobs (deal expiry, etc.)
  if (process.env.NODE_ENV !== 'test') {
    startCronJobs();
  }
});

// Graceful shutdown — Render/Railway send SIGTERM before stopping the container.
// We stop accepting new requests, let in-flight ones finish, then disconnect Prisma.
async function shutdown(signal) {
  console.log(`[${signal}] Shutting down gracefully…`);
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    console.log('Server closed. Exiting.');
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown hangs
  // .unref() prevents this timer from keeping Node alive on its own
  setTimeout(() => {
    console.error('Shutdown timeout — forcing exit.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
