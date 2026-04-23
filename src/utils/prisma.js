const { PrismaClient } = require('@prisma/client');

// Connection pool: Prisma defaults to 10. On Render/Railway free tier, set
// ?connection_limit=5 in DATABASE_URL to avoid exhausting 512MB RAM.
// e.g. postgresql://user:pass@host/db?connection_limit=5&connect_timeout=10
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  // Suppress internal Prisma stack traces in production error objects
  errorFormat: process.env.NODE_ENV === 'production' ? 'minimal' : 'pretty',
});

module.exports = prisma;
