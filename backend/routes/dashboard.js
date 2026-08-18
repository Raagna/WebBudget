const express = require('express');
const { query, queryOne } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { fromCents } = require('../middleware/validate');

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

// GET /api/dashboard/summary?profileId=&month=YYYY-MM  (month defaults to current)
router.get('/summary', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res);
  if (profileId === null) return;

  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const { start, end } = monthBounds(month);

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
     WHERE t.profile_id = ?
     ORDER BY t.occurred_on DESC, t.id DESC
     LIMIT 8`,
    [profileId]
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

  const rows = await query(
    `SELECT TO_CHAR(occurred_on, 'YYYY-MM') AS month, type, COALESCE(SUM(amount_cents), 0)::bigint AS total
     FROM transactions
     WHERE profile_id = ? AND occurred_on >= (CURRENT_DATE - (?::int * INTERVAL '1 month'))
     GROUP BY month, type
     ORDER BY month ASC`,
    [profileId, months]
  );

  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month, income: 0, expenses: 0 });
    byMonth.get(r.month)[r.type === 'income' ? 'income' : 'expenses'] = fromCents(Number(r.total));
  }
  res.json({ trends: [...byMonth.values()] });
}));

module.exports = router;
