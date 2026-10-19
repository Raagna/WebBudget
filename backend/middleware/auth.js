const jwt = require('jsonwebtoken');
const { queryOne } = require('../db');

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
 *
 * A valid signature isn't enough on its own: the token's version must
 * still match users.token_version (migration 017), which "sign out
 * everywhere" and password changes bump. That lookup also rejects tokens
 * for an account that has since been deleted - before it, they kept
 * passing here for the rest of their 7 days.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await queryOne('SELECT token_version FROM users WHERE id = ?', [payload.sub]);
    // Tokens signed before migration 017 have no tv; they count as version
    // 0 so the deploy itself doesn't sign everyone out.
    if (!user || user.token_version !== (payload.tv ?? 0)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (err) {
    return next(err);
  }

  req.userId = payload.sub;
  next();
}

function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, signToken };
