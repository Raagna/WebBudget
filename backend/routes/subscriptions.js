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
    billingCycle: (v) => ['weekly', 'monthly', 'yearly'].includes(v),
    nextBillingOn: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const { name, amount, billingCycle, nextBillingOn, categoryId } = req.body;
    const inserted = await queryOne(
      `INSERT INTO subscriptions (user_id, category_id, name, amount_cents, billing_cycle, next_billing_on, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE) RETURNING id`,
      [req.userId, categoryId || null, name.trim(), toCents(amount), billingCycle, nextBillingOn]
    );
    res.status(201).json({ id: inserted.id });
  })
);

router.put('/:id', asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT id FROM subscriptions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!existing) return res.status(404).json({ error: 'Subscription not found' });

  const fields = [];
  const params = [];
  const { name, amount, billingCycle, nextBillingOn, isActive, categoryId } = req.body;

  if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
  if (amount !== undefined && isPositiveAmount(Number(amount))) { fields.push('amount_cents = ?'); params.push(toCents(Number(amount))); }
  if (billingCycle !== undefined) { fields.push('billing_cycle = ?'); params.push(billingCycle); }
  if (nextBillingOn !== undefined && isValidDate(nextBillingOn)) { fields.push('next_billing_on = ?'); params.push(nextBillingOn); }
  if (isActive !== undefined) { fields.push('is_active = ?'); params.push(!!isActive); }
  if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }

  if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  await run(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, [...params, req.params.id, req.userId]);
  res.status(200).json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await run('DELETE FROM subscriptions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Subscription not found' });
  res.status(204).end();
}));

module.exports = router;
