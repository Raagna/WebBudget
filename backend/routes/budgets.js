const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isPositiveAmount, toCents, fromCents, validateBody } = require('../middleware/validate');
const { monthPeriod, daysLeftInMonth } = require('../utils/period');

const router = express.Router();
router.use(requireAuth);

// Same membership rule as transactions: any active member of a profile
// (owner or invited member) can see and change its budgets.
async function requireMember(req, res, profileIdRaw) {
  const profileId = Number(profileIdRaw);
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

// GET /api/budgets?profileId=&today=YYYY-MM-DD&month=YYYY-MM
// Every budget in the profile with what's been spent in its category this
// month (up to today - a transaction dated later hasn't happened yet),
// plus the spending that falls outside any budget.
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.query.profileId);
  if (profileId === null) return;
  const { today, month, start, end } = monthPeriod(req);

  const rows = await query(
    `SELECT b.id, b.category_id, c.name AS category_name, c.icon AS category_icon, b.amount_cents,
            COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
                      WHERE t.profile_id = b.profile_id AND t.category_id = b.category_id
                        AND t.type = 'expense' AND t.occurred_on BETWEEN ? AND ?), 0)::bigint AS spent_cents
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     WHERE b.profile_id = ?`,
    [start, end, profileId]
  );

  const budgets = rows.map((r) => {
    const amount = Number(r.amount_cents);
    const spent = Number(r.spent_cents);
    return {
      id: r.id,
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryIcon: r.category_icon,
      amount: fromCents(amount),
      spent: fromCents(spent),
      remaining: fromCents(amount - spent), // negative = over budget
      percent: Math.round((spent / amount) * 100),
    };
  }).sort((a, b) => b.percent - a.percent || a.categoryName.localeCompare(b.categoryName));

  const unbudgeted = await queryOne(
    `SELECT COALESCE(SUM(t.amount_cents), 0)::bigint AS cents
     FROM transactions t
     WHERE t.profile_id = ? AND t.type = 'expense' AND t.occurred_on BETWEEN ? AND ?
       AND (t.category_id IS NULL OR t.category_id NOT IN (SELECT category_id FROM budgets WHERE profile_id = ?))`,
    [profileId, start, end, profileId]
  );

  const budgetedCents = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
  const spentCents = rows.reduce((s, r) => s + Number(r.spent_cents), 0);
  res.json({
    month,
    daysLeft: month === today.slice(0, 7) ? daysLeftInMonth(today) : 0,
    budgets,
    totals: {
      budgeted: fromCents(budgetedCents),
      spent: fromCents(spentCents),
      // Only what's still unspent in budgets that aren't already over.
      remaining: fromCents(rows.reduce((s, r) => s + Math.max(0, Number(r.amount_cents) - Number(r.spent_cents)), 0)),
      unbudgetedSpent: fromCents(Number(unbudgeted.cents)),
    },
  });
}));

// PUT /api/budgets { profileId, categoryId, amount }
// Creates or updates the monthly budget for one category.
router.put(
  '/',
  validateBody({
    categoryId: (v) => Number.isInteger(v) && v > 0,
    amount: isPositiveAmount,
  }),
  asyncHandler(async (req, res) => {
    const profileId = await requireMember(req, res, req.body.profileId);
    if (profileId === null) return;
    const { categoryId, amount } = req.body;

    // The category must be one this user can see (a default or their own)
    // and usable for spending. In a shared household, another member may
    // have budgeted their own custom category; editing that existing
    // budget is allowed even though the category isn't in this user's list.
    const category = await queryOne(
      `SELECT c.id, c.type FROM categories c
       WHERE c.id = ?
         AND (c.user_id IS NULL OR c.user_id = ?
              OR EXISTS (SELECT 1 FROM budgets b WHERE b.profile_id = ? AND b.category_id = c.id))`,
      [categoryId, req.userId, profileId]
    );
    if (!category) return res.status(400).json({ error: 'Invalid category' });
    if (category.type === 'income') return res.status(400).json({ error: 'Budgets are for spending categories' });

    const saved = await queryOne(
      `INSERT INTO budgets (profile_id, category_id, amount_cents, created_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, category_id)
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents, updated_at = NOW()
       RETURNING id`,
      [profileId, categoryId, toCents(amount), req.userId]
    );
    res.json({ id: saved.id, categoryId, amount });
  })
);

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Budget not found' });
  const result = await run(
    `DELETE FROM budgets b
     WHERE b.id = ?
       AND EXISTS (SELECT 1 FROM profile_members pm
                   WHERE pm.profile_id = b.profile_id AND pm.user_id = ? AND pm.status = 'active')`,
    [id, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Budget not found' });
  res.status(204).end();
}));

module.exports = router;
