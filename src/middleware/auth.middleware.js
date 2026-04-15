const { verifyToken } = require('../utils/jwt');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.admin = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid.' });
  }
}

module.exports = { authenticate };
