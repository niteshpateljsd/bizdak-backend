const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!SECRET) {
  console.error('[FATAL] JWT_SECRET env var is not set. Server cannot start safely.');
  process.exit(1);
}
if (SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET is too short (min 32 chars). Use a strong random secret.');
  process.exit(1);
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
