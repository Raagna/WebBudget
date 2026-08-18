// Lightweight, dependency-free validation helpers. Every field coming from
// the client is checked here before it ever reaches a SQL statement.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v, maxLen = 255) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function isValidEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v) && v.length <= 254;
}

function isValidDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

function isPositiveAmount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1_000_000_000;
}

// Amounts are accepted from clients as decimal dollars (e.g. 65.4) and
// converted to integer cents for storage, which avoids floating-point
// rounding drift when totals are summed later.
function toCents(dollars) {
  return Math.round(dollars * 100);
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

// Used by bulk endpoints: an array of 1-200 positive integers.
function isIdArray(v) {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 200 &&
    v.every((n) => Number.isInteger(n) && n > 0)
  );
}

function validateBody(rules) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, check] of Object.entries(rules)) {
      const value = req.body[field];
      if (!check(value)) errors.push(field);
    }
    if (errors.length) {
      return res.status(400).json({ error: 'Invalid input', fields: errors });
    }
    next();
  };
}

module.exports = {
  isNonEmptyString,
  isValidEmail,
  isValidDate,
  isPositiveAmount,
  isIdArray,
  toCents,
  fromCents,
  validateBody,
};
