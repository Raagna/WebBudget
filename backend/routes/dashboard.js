const express = require('express');
const db = require('../db');
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

// GET /api/dashboard/summary?month=YYYY-MM  (defaults to current month)
router.get('/summary', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const { start, end } = monthBounds(month);

  const totals = db
    .prepare(
      `SELECT type, COALESCE(SUM(amount_cents), 0) AS total
       FROM transactions
       WHERE user_id = ? AND occurred_on BETWEEN ? AND ?
       GROUP BY type`
    )
    .all(req.userId, start, end);

  const income = fromCents(totals.find((t) => t.type === 'income')?.total || 0);
  const expenses = fromCents(totals.find((t) => t.type === 'expense')?.total || 0);

  const byCategory = db
    .prepare(
      `SELECT c.name AS category, COALESCE(SUM(t.amount_cents), 0) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.type = 'expense' AND t.occurred_on BETWEEN ? AND ?
       GROUP BY t.category_id
       ORDER BY total DESC`
    )
    .all(req.userId, start, end)
    .map((r) => ({ category: r.category || 'Uncategorized', total: fromCents(r.total) }));

  const recent = db
    .prepare(
      `SELECT t.id, t.amount_cents, t.type, t.description, t.occurred_on, c.name AS category_name
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ?
       ORDER BY t.occurred_on DESC, t.id DESC
       LIMIT 8`
    )
    .all(req.userId)
    .map((r) => ({
      id: r.id,
      amount: fromCents(r.amount_cents),
      type: r.type,
      description: r.description,
      date: r.occurred_on,
      category: r.category_name || 'Uncategorized',
    }));

  const upcomingBills = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total
       FROM bills WHERE user_id = ? AND is_paid = 0 AND due_on >= date('now')`
    )
    .get(req.userId);

  const activeSubscriptions = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total
       FROM subscriptions WHERE user_id = ? AND is_active = 1`
    )
    .get(req.userId);

  res.json({
    month,
    income,
    expenses,
    net: Math.round((income - expenses) * 100) / 100,
    largestCategory: byCategory[0]?.category || null,
    spendingByCategory: byCategory,
    recentTransactions: recent,
    upcomingBills: { count: upcomingBills.n, total: fromCents(upcomingBills.total) },
    activeSubscriptions: { count: activeSubscriptions.n, total: fromCents(activeSubscriptions.total) },
  });
});

// GET /api/dashboard/trends?months=6  -> income vs expenses per month
router.get('/trends', (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', occurred_on) AS month, type, COALESCE(SUM(amount_cents), 0) AS total
       FROM transactions
       WHERE user_id = ? AND occurred_on >= date('now', ?)
       GROUP BY month, type
       ORDER BY month ASC`
    )
    .all(req.userId, `-${months} months`);

  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month, income: 0, expenses: 0 });
    byMonth.get(r.month)[r.type === 'income' ? 'income' : 'expenses'] = fromCents(r.total);
  }
  res.json({ trends: [...byMonth.values()] });
});

module.exports = router;
