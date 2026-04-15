const bcrypt = require('bcryptjs');
const { signToken } = require('../utils/jwt');

// Single admin user loaded from env (no user table — admin-only access)
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminHash = process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD;

    if (email !== adminEmail) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Support both plain (dev) and bcrypt hash (prod)
    let valid = false;
    if (adminHash.startsWith('$2')) {
      valid = await bcrypt.compare(password, adminHash);
    } else {
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

async function me(req, res) {
  res.json({ role: req.admin.role, email: req.admin.email });
}

module.exports = { login, me };
