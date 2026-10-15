const express = require('express');
const { query, queryOne } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { fromCents, isValidDate } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const start = `${yyyyMm}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
  return { start, end };
}

// All dashboard figures are scoped to one profile at a time, so switching
// profiles in the UI shows an entirely separate financial picture. Access
// is membership-based (see routes/transactions.js for the full rationale):
// any active member of the profile - owner or invited member - can view
// its dashboard, not just the original creator.
async function requireOwnedProfile(req, res) {
  const profileId = Number(req.query.profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    res.status(400).json({ error: 'A valid profileId is required' });
    return null;
  }
  const member = await queryOne(
    `SELECT 1 FROM profile_members WHERE profile_id = ? AND user_id = ? AND status = 'active'`,
    [profileId, req.userId]
  );
  if (!member) {
    res.status(404).json({ error: 'Profile not found' });
    return null;
  }
  return profileId;
}

// "Today" in the USER's timezone, which the server can't know: the
// browser sends it as ?today=YYYY-MM-DD. Without it, the server's UTC
// date is used, which is already tomorrow for North America in the
// evening - so the dashboard could show next month, or count a
// transaction dated tomorrow as already spent.
function userToday(req) {
  return isValidDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
}

// GET /api/dashboard/summary?profileId=&today=YYYY-MM-DD&month=YYYY-MM
// month defaults to the month of `today`. Totals, categories and recent
// transactions only count what has happened up to `today`: a transaction
// entered with a future date (rent due next week, a scheduled transfer)
// isn't spending yet, and counting it made "Remaining" misleadingly low.
router.get('/summary', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res);
  if (profileId === null) return;

  const today = userToday(req);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : today.slice(0, 7);
  const { start, end: monthEnd } = monthBounds(month);
  const end = monthEnd < today ? monthEnd : today;

  const totals = await query(
    `SELECT type, COALESCE(SUM(amount_cents), 0)::bigint AS total
     FROM transactions
     WHERE profile_id = ? AND occurred_on BETWEEN ? AND ?
     GROUP BY type`,
    [profileId, start, end]
  );

  const income = fromCents(Number(totals.find((t) => t.type === 'income')?.total || 0));
  const expenses = fromCents(Number(totals.find((t) => t.type === 'expense')?.total || 0));

  const byCategoryRows = await query(
    `SELECT c.name AS category, COALESCE(SUM(t.amount_cents), 0)::bigint AS total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.profile_id = ? AND t.type = 'expense' AND t.occurred_on BETWEEN ? AND ?
     GROUP BY t.category_id, c.name
     ORDER BY total DESC`,
    [profileId, start, end]
  );
  const byCategory = byCategoryRows.map((r) => ({ category: r.category || 'Uncategorized', total: fromCents(Number(r.total)) }));

  const recentRows = await query(
    `SELECT t.id, t.amount_cents, t.type, t.description, t.occurred_on, c.name AS category_name
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.profile_id = ? AND t.occurred_on <= ?
     ORDER BY t.occurred_on DESC, t.id DESC
     LIMIT 8`,
    [profileId, today]
  );
  const recent = recentRows.map((r) => ({
    id: r.id,
    amount: fromCents(r.amount_cents),
    type: r.type,
    description: r.description,
    date: r.occurred_on,
    category: r.category_name || 'Uncategorized',
  }));

  res.json({
    month,
    income,
    expenses,
    net: Math.round((income - expenses) * 100) / 100,
    largestCategory: byCategory[0]?.category || null,
    spendingByCategory: byCategory,
    recentTransactions: recent,
  });
}));

// GET /api/dashboard/trends?profileId=&months=6  -> income vs expenses per month
router.get('/trends', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res);
  if (profileId === null) return;

  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);

  // Same "up to the user's today" rule as /summary, so the current month's
  // point on the chart matches the dashboard cards.
  const today = userToday(req);
  const rows = await query(
    `SELECT TO_CHAR(occurred_on, 'YYYY-MM') AS month, type, COALESCE(SUM(amount_cents), 0)::bigint AS total
     FROM transactions
     WHERE profile_id = ? AND occurred_on <= ?::date
       AND occurred_on >= (?::date - (?::int * INTERVAL '1 month'))
     GROUP BY month, type
     ORDER BY month ASC`,
    [profileId, today, today, months]
  );

  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month, income: 0, expenses: 0 });
    byMonth.get(r.month)[r.type === 'income' ? 'income' : 'expenses'] = fromCents(Number(r.total));
  }
  res.json({ trends: [...byMonth.values()] });
}));

module.exports = router;
