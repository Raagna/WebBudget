const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, isValidDate, isPositiveAmount, toCents, fromCents, validateBody } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    amount: fromCents(row.amount_cents),
    billingCycle: row.billing_cycle,
    nextBillingOn: row.next_billing_on,
    isActive: !!row.is_active,
    categoryId: row.category_id,
    categoryName: row.category_name,
  };
}

// Same visibility rule as transactions and bills: shared defaults plus the
// caller's own categories. Without it, saving a subscription with another
// user's private category id and reading the list back revealed that
// category's name. Returns false (and has sent a 400) for anything else.
async function checkCategory(req, res, categoryId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return true;
  if (!Number.isInteger(Number(categoryId)) || Number(categoryId) <= 0) {
    res.status(400).json({ error: 'Invalid category' });
    return false;
  }
  const cat = await queryOne(
    'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
    [categoryId, req.userId]
  );
  if (!cat) {
    res.status(400).json({ error: 'Invalid category' });
    return false;
  }
  return true;
}

const BILLING_CYCLES = ['weekly', 'monthly', 'yearly'];

router.get('/', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT s.*, c.name AS category_name FROM subscriptions s
     LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.user_id = ? ORDER BY s.next_billing_on ASC`,
    [req.userId]
  );
  res.json({ subscriptions: rows.map(serialize) });
}));

router.post(
  '/',
  validateBody({
    name: (v) => isNonEmptyString(v, 100),
    amount: isPositiveAmount,
    billingCycle: (v) => BILLING_CYCLES.includes(v),
    nextBillingOn: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const { name, amount, billingCycle, nextBillingOn, categoryId } = req.body;
    if (!(await checkCategory(req, res, categoryId))) return;

    const inserted = await queryOne(
      `INSERT INTO subscriptions (user_id, category_id, name, amount_cents, billing_cycle, next_billing_on, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE) RETURNING id`,
      [req.userId, categoryId || null, name.trim(), toCents(amount), billingCycle, nextBillingOn]
    );
    res.status(201).json({ id: inserted.id });
  })
);

// Every field is optional, but one that IS sent must be valid - this
// used to skip a bad amount or date silently and pass a bad billing cycle
// or name through to the database.
router.put(
  '/:id',
  validateBody({
    name: (v) => v === undefined || isNonEmptyString(v, 100),
    amount: (v) => v === undefined || isPositiveAmount(v),
    billingCycle: (v) => v === undefined || BILLING_CYCLES.includes(v),
    nextBillingOn: (v) => v === undefined || isValidDate(v),
  }),
  asyncHandler(async (req, res) => {
    const existing = await queryOne('SELECT id FROM subscriptions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!existing) return res.status(404).json({ error: 'Subscription not found' });

    const { name, amount, billingCycle, nextBillingOn, isActive, categoryId } = req.body;
    if (!(await checkCategory(req, res, categoryId))) return;

    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name.trim()); }
    if (amount !== undefined) { fields.push('amount_cents = ?'); params.push(toCents(amount)); }
    if (billingCycle !== undefined) { fields.push('billing_cycle = ?'); params.push(billingCycle); }
    if (nextBillingOn !== undefined) { fields.push('next_billing_on = ?'); params.push(nextBillingOn); }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(!!isActive); }
    if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }

    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    await run(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, [...params, req.params.id, req.userId]);
    res.status(200).json({ ok: true });
  })
);

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await run('DELETE FROM subscriptions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Subscription not found' });
  res.status(204).end();
}));

module.exports = router;
