/**
 * versionCheck middleware
 *
 * Reads the App-Version header sent by the mobile app on every request.
 * If the version is below MIN_APP_VERSION (set as an env var on Render),
 * returns 426 Upgrade Required — the mobile app shows a forced update screen.
 *
 * To force an update:
 *   Set MIN_APP_VERSION=1.1.0 on Render → all users on 1.0.x see the update screen.
 *
 * Skips the check if no App-Version header is present (admin, curl, Postman).
 */

function parseVersion(v) {
  return (v || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
}

function isVersionBelow(version, minimum) {
  const [va, vb, vc] = parseVersion(version);
  const [ma, mb, mc] = parseVersion(minimum);
  if (va !== ma) return va < ma;
  if (vb !== mb) return vb < mb;
  return vc < mc;
}

function versionCheck(req, res, next) {
  const minVersion = process.env.MIN_APP_VERSION;
  if (!minVersion) return next(); // not configured — skip check

  const clientVersion = req.headers['app-version'];
  if (!clientVersion) return next(); // no header — admin/curl/Postman — skip

  if (isVersionBelow(clientVersion, minVersion)) {
    return res.status(426).json({
      error: 'App update required.',
      minimumVersion: minVersion,
      currentVersion: clientVersion,
    });
  }

  next();
}

module.exports = { versionCheck };
