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
    dueOn: row.due_on,
    isPaid: !!row.is_paid,
    isRecurring: !!row.is_recurring,
    categoryId: row.category_id,
    categoryName: row.category_name,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT b.*, c.name AS category_name FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.user_id = ? ORDER BY b.due_on ASC`,
    [req.userId]
  );
  res.json({ bills: rows.map(serialize) });
}));

router.post(
  '/',
  validateBody({
    name: (v) => isNonEmptyString(v, 100),
    amount: isPositiveAmount,
    dueOn: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const { name, amount, dueOn, categoryId, isRecurring } = req.body;
    const inserted = await queryOne(
      `INSERT INTO bills (user_id, category_id, name, amount_cents, due_on, is_paid, is_recurring)
       VALUES (?, ?, ?, ?, ?, FALSE, ?) RETURNING id`,
      [req.userId, categoryId || null, name.trim(), toCents(amount), dueOn, !!isRecurring]
    );
    res.status(201).json({ id: inserted.id });
  })
);

router.put('/:id', asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT id FROM bills WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!existing) return res.status(404).json({ error: 'Bill not found' });

  const fields = [];
  const params = [];
  const { name, amount, dueOn, isPaid, isRecurring, categoryId } = req.body;

  if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
  if (amount !== undefined && isPositiveAmount(Number(amount))) { fields.push('amount_cents = ?'); params.push(toCents(Number(amount))); }
  if (dueOn !== undefined && isValidDate(dueOn)) { fields.push('due_on = ?'); params.push(dueOn); }
  if (isPaid !== undefined) { fields.push('is_paid = ?'); params.push(!!isPaid); }
  if (isRecurring !== undefined) { fields.push('is_recurring = ?'); params.push(!!isRecurring); }
  if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }

  if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  await run(`UPDATE bills SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, [...params, req.params.id, req.userId]);
  res.status(200).json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await run('DELETE FROM bills WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Bill not found' });
  res.status(204).end();
}));

module.exports = router;
