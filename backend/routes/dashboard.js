const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { fromCents } = require('../middleware/validate');
const { userToday, monthPeriod, daysLeftInMonth, sameStretchLastMonth } = require('../utils/period');

const router = express.Router();
router.use(requireAuth);

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

// GET /api/dashboard/summary?profileId=&today=YYYY-MM-DD&month=YYYY-MM
// month defaults to the month of `today`. Totals, categories and recent
// transactions only count what has happened up to `today`: a transaction
// entered with a future date (rent due next week, a scheduled transfer)
// isn't spending yet, and counting it made "Remaining" misleadingly low.
router.get('/summary', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res);
  if (profileId === null) return;

  const { today, month, start, monthEnd, end } = monthPeriod(req);

  const totals = await query(
    `SELECT type, COALESCE(SUM(amount_cents), 0)::bigint AS total
     FROM transactions
     WHERE profile_id = ? AND occurred_on BETWEEN ? AND ?
     GROUP BY type`,
    [profileId, start, end]
  );

  const income = fromCents(Number(totals.find((t) => t.type === 'income')?.total || 0));
  const expenses = fromCents(Number(totals.find((t) => t.type === 'expense')?.total || 0));

  // The same stretch of last month (1st..same day), so the page can say
  // "€120 more than this point last month" fairly.
  const last = sameStretchLastMonth(end);
  const lastTotals = await query(
    `SELECT type, COALESCE(SUM(amount_cents), 0)::bigint AS total
     FROM transactions
     WHERE profile_id = ? AND occurred_on BETWEEN ? AND ?
     GROUP BY type`,
    [profileId, last.start, last.end]
  );
  const lastMonthToDate = {
    from: last.start,
    to: last.end,
    income: fromCents(Number(lastTotals.find((t) => t.type === 'income')?.total || 0)),
    expenses: fromCents(Number(lastTotals.find((t) => t.type === 'expense')?.total || 0)),
  };

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
    lastMonthToDate,
    largestCategory: byCategory[0]?.category || null,
    spendingByCategory: byCategory,
    recentTransactions: recent,
    safeToSpend: month === today.slice(0, 7)
      ? await safeToSpend(profileId, { today, start, monthEnd, incomeCents: Math.round(income * 100), spentCents: Math.round(expenses * 100) })
      : null, // only meaningful for the month you're in
  });
}));

// "Safe to spend": what's left this month once money already committed is
// set aside. Deliberately conservative, so it's safe to act on:
//   income received so far
//   - spending so far
//   - unpaid bills due by the end of the month (including overdue ones)
//   - expenses already entered with a later date this month (scheduled)
// Income that hasn't arrived yet is NOT counted. perDay spreads what's
// left over the days remaining, today included.
async function safeToSpend(profileId, { today, start, monthEnd, incomeCents, spentCents }) {
  const bills = await query(
    `SELECT id, name, amount_cents, due_on FROM bills
     WHERE profile_id = ? AND is_paid = FALSE AND due_on <= ?
     ORDER BY due_on ASC, id ASC`,
    [profileId, monthEnd]
  );
  const scheduled = await queryOne(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS cents, COUNT(*)::int AS n
     FROM transactions
     WHERE profile_id = ? AND type = 'expense' AND occurred_on > ? AND occurred_on BETWEEN ? AND ?`,
    [profileId, today, start, monthEnd]
  );

  const billsCents = bills.reduce((s, b) => s + Number(b.amount_cents), 0);
  const scheduledCents = Number(scheduled.cents);
  const safeCents = incomeCents - spentCents - billsCents - scheduledCents;
  const daysLeft = daysLeftInMonth(today);

  return {
    amount: fromCents(safeCents), // negative = already committed more than came in
    income: fromCents(incomeCents),
    spent: fromCents(spentCents),
    billsDue: fromCents(billsCents),
    scheduled: fromCents(scheduledCents),
    scheduledCount: scheduled.n,
    daysLeft,
    perDay: fromCents(Math.max(0, Math.floor(safeCents / daysLeft))),
    upcomingBills: bills.slice(0, 5).map((b) => ({
      id: b.id,
      name: b.name,
      amount: fromCents(Number(b.amount_cents)),
      dueOn: b.due_on,
      overdue: b.due_on < today,
    })),
  };
}

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

// ---------- Layout ----------
//
// { widgets: ['safe', 'news', ...], layouts: { xl: [...], lg: [...], sm: [...] } }
// widgets lists what's shown; each layout places those widgets on a grid
// of COLS[breakpoint] columns as { i, x, y, w, h } in grid units. Only the
// shape is checked here - the frontend ignores ids it doesn't know.
const COLS = { xl: 18, lg: 12, sm: 1 };
const WIDGET_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_WIDGETS = 24;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function cleanLayout(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { widgets, layouts } = body;
  if (!Array.isArray(widgets) || widgets.length > MAX_WIDGETS) return null;
  if (!widgets.every((id) => typeof id === 'string' && WIDGET_ID.test(id))) return null;
  if (new Set(widgets).size !== widgets.length) return null;
  if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return null;

  const out = { widgets: [...widgets], layouts: {} };
  for (const [bp, items] of Object.entries(layouts)) {
    const cols = COLS[bp];
    if (!cols || !Array.isArray(items) || items.length > MAX_WIDGETS) return null;
    const seen = new Set();
    const clean = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') return null;
      const { i, x, y, w, h } = it;
      if (!widgets.includes(i) || seen.has(i)) return null;
      if (!isInt(w, 1, cols) || !isInt(x, 0, cols - w) || !isInt(y, 0, 2000) || !isInt(h, 1, 60)) return null;
      seen.add(i);
      clean.push({ i, x, y, w, h });
    }
    out.layouts[bp] = clean;
  }
  return out;
}

// GET /api/dashboard/layout -> { layout } (null = the default layout)
router.get('/layout', asyncHandler(async (req, res) => {
  const row = await queryOne(`SELECT dashboard_layout FROM users WHERE id = ?`, [req.userId]);
  res.json({ layout: row?.dashboard_layout || null });
}));

// PUT /api/dashboard/layout  { layout }   layout: null resets to default
router.put('/layout', asyncHandler(async (req, res) => {
  if (req.body.layout === null) {
    await run(`UPDATE users SET dashboard_layout = NULL WHERE id = ?`, [req.userId]);
    return res.json({ layout: null });
  }
  const layout = cleanLayout(req.body.layout);
  if (!layout) return res.status(400).json({ error: 'Invalid dashboard layout' });
  await run(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(layout), req.userId]);
  res.json({ layout });
}));

// ---------- Layout presets ----------
//
// Named layouts a user can switch between. Per user, so they follow the
// user into every household. Same layout shape as above.
const MAX_PRESETS = 20;
const presetName = (v) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 40 ? v.trim() : null);
const presetOut = (r) => ({ id: r.id, name: r.name, layout: r.layout });

// GET /api/dashboard/layout/presets -> { presets: [{ id, name, layout }] }
router.get('/layout/presets', asyncHandler(async (req, res) => {
  const rows = await query(`SELECT id, name, layout FROM dashboard_presets WHERE user_id = ? ORDER BY lower(name), id`, [req.userId]);
  res.json({ presets: rows.map(presetOut) });
}));

// POST /api/dashboard/layout/presets  { name, layout }
router.post('/layout/presets', asyncHandler(async (req, res) => {
  const name = presetName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name the preset (up to 40 characters).' });
  const layout = cleanLayout(req.body.layout);
  if (!layout) return res.status(400).json({ error: 'Invalid dashboard layout' });
  const existing = await query(`SELECT name FROM dashboard_presets WHERE user_id = ?`, [req.userId]);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `You already have a preset called "${name}".` });
  }
  if (existing.length >= MAX_PRESETS) return res.status(400).json({ error: `You can keep up to ${MAX_PRESETS} presets.` });
  const row = await queryOne(
    `INSERT INTO dashboard_presets (user_id, name, layout) VALUES (?, ?, ?) RETURNING id, name, layout`,
    [req.userId, name, JSON.stringify(layout)]
  );
  res.status(201).json({ preset: presetOut(row) });
}));

// PUT /api/dashboard/layout/presets/:id  { name?, layout? }
// Renames it, or overwrites it with the layout being edited.
router.put('/layout/presets/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const current = await queryOne(`SELECT id FROM dashboard_presets WHERE id = ? AND user_id = ?`, [id, req.userId]);
  if (!current) return res.status(404).json({ error: 'Preset not found' });
  const fields = [];
  const params = [];
  if (req.body.name !== undefined) {
    const name = presetName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Name the preset (up to 40 characters).' });
    const clash = await queryOne(
      `SELECT 1 FROM dashboard_presets WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?`,
      [req.userId, name, id]
    );
    if (clash) return res.status(409).json({ error: `You already have a preset called "${name}".` });
    fields.push('name = ?');
    params.push(name);
  }
  if (req.body.layout !== undefined) {
    const layout = cleanLayout(req.body.layout);
    if (!layout) return res.status(400).json({ error: 'Invalid dashboard layout' });
    fields.push('layout = ?');
    params.push(JSON.stringify(layout));
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const row = await queryOne(
    `UPDATE dashboard_presets SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ? RETURNING id, name, layout`,
    [...params, id]
  );
  res.json({ preset: presetOut(row) });
}));

// DELETE /api/dashboard/layout/presets/:id
router.delete('/layout/presets/:id', asyncHandler(async (req, res) => {
  const result = await run(`DELETE FROM dashboard_presets WHERE id = ? AND user_id = ?`, [Number(req.params.id) || 0, req.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Preset not found' });
  res.status(204).end();
}));

module.exports = router;
