const bcrypt = require('bcryptjs');
const { signToken } = require('../utils/jwt');

// Single admin user loaded from env (no user table — admin-only access)
async function login(req, res, next) {
  try {
    const { password } = req.body;
    const email = req.body.email?.toLowerCase().trim();

    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim(); // normalise env var too
    const adminHash = process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD;
    if (!adminHash) {
      console.error('[Auth] SECURITY: No admin password configured.');
      return res.status(500).json({ error: 'Server misconfiguration. Contact the administrator.' });
    }

    if (email !== adminEmail) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Support both plain (dev only!) and bcrypt hash (prod)
    let valid = false;
    if (adminHash.startsWith('$2')) {
      valid = await bcrypt.compare(password, adminHash);
    } else {
      // Plain text password — only acceptable in local development
      if (process.env.NODE_ENV === 'production') {
        console.error('[Auth] SECURITY: Plain text ADMIN_PASSWORD used in production. Set ADMIN_PASSWORD_HASH to a bcrypt hash immediately.');
        return res.status(500).json({ error: 'Server misconfiguration. Contact the administrator.' });
      }
      valid = password === adminHash;
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = signToken({ role: 'admin', email: adminEmail });
    res.json({ token });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    res.json({ role: req.admin.role, email: req.admin.email });
  } catch (err) { next(err); }
}

module.exports = { login, me };
