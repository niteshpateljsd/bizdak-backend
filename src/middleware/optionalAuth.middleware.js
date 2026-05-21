const { verifyToken } = require('../utils/jwt');

/**
 * optionalAuthenticate
 *
 * Like authenticate, but does NOT reject unauthenticated requests.
 * Sets req.admin if a valid Bearer token is present; otherwise a no-op.
 * Used on public endpoints that have enhanced behaviour for admins
 * (e.g. deal list returns inactive deals when req.admin is set).
 */
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) {
      try { req.admin = verifyToken(token); } catch { /* invalid token — treat as unauthenticated */ }
    }
  }
  next();
}

module.exports = { optionalAuthenticate };
