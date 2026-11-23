const jwt = require('jsonwebtoken');

/**
 * JWT authentication middleware.
 * Protects /api/playlists, /api/settings, /api/r2, and /api/auth/me endpoints,
 * attaching req.user = { id, email, displayName, role }.
 */
function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Server authentication not configured (missing JWT_SECRET)' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, secret);
    req.user = {
      id: String(payload.sub || payload.id),
      email: payload.email,
      displayName: payload.displayName,
      role: payload.role || 'member',
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

module.exports = { requireAuth };
