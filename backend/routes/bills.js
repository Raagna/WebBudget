const express = require('express');
const db = require('../db');
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

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, c.name AS category_name FROM bills b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.user_id = ? ORDER BY b.due_on ASC`
    )
    .all(req.userId);
  res.json({ bills: rows.map(serialize) });
});

router.post(
  '/',
  validateBody({
    name: (v) => isNonEmptyString(v, 100),
    amount: isPositiveAmount,
    dueOn: isValidDate,
  }),
  (req, res) => {
    const { name, amount, dueOn, categoryId, isRecurring } = req.body;
    const info = db
      .prepare(
        `INSERT INTO bills (user_id, category_id, name, amount_cents, due_on, is_paid, is_recurring)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .run(req.userId, categoryId || null, name.trim(), toCents(amount), dueOn, isRecurring ? 1 : 0);
    res.status(201).json({ id: info.lastInsertRowid });
  }
);

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Bill not found' });

  const fields = [];
  const params = [];
  const { name, amount, dueOn, isPaid, isRecurring, categoryId } = req.body;

  if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
  if (amount !== undefined && isPositiveAmount(Number(amount))) { fields.push('amount_cents = ?'); params.push(toCents(Number(amount))); }
  if (dueOn !== undefined && isValidDate(dueOn)) { fields.push('due_on = ?'); params.push(dueOn); }
  if (isPaid !== undefined) { fields.push('is_paid = ?'); params.push(isPaid ? 1 : 0); }
  if (isRecurring !== undefined) { fields.push('is_recurring = ?'); params.push(isRecurring ? 1 : 0); }
  if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }

  if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  db.prepare(`UPDATE bills SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...params, req.params.id, req.userId);
  res.status(200).json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM bills WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Bill not found' });
  res.status(204).end();
});

module.exports = router;
