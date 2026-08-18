const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly at boot rather than silently signing tokens with a weak
  // fallback secret in production.
  throw new Error('JWT_SECRET is not set. Define it in backend/.env');
}

/**
 * Verifies the bearer token and attaches req.userId.
 * This is the ONLY place userId is derived for downstream route handlers -
 * every financial route trusts req.userId, never a value from the request
 * body or query string, so users cannot access each other's data by
 * tampering with parameters.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, signToken };
