const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  isNonEmptyString,
  isValidDate,
  isPositiveAmount,
  toCents,
  fromCents,
  validateBody,
} = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const SORTABLE_COLUMNS = new Set(['occurred_on', 'amount_cents', 'description', 'type']);

function serialize(row) {
  return {
    id: row.id,
    amount: fromCents(row.amount_cents),
    type: row.type,
    description: row.description,
    date: row.occurred_on,
    isRecurring: !!row.is_recurring,
    recurringInterval: row.recurring_interval,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
  };
}

// GET /api/transactions?type=&categoryId=&from=&to=&minAmount=&maxAmount=&sort=&dir=&limit=&offset=
router.get('/', (req, res) => {
  const { type, categoryId, from, to, minAmount, maxAmount } = req.query;
  const sort = SORTABLE_COLUMNS.has(req.query.sort) ? req.query.sort : 'occurred_on';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const clauses = ['t.user_id = ?'];
  const params = [req.userId];

  if (type === 'income' || type === 'expense') {
    clauses.push('t.type = ?');
    params.push(type);
  }
  if (categoryId && Number.isInteger(Number(categoryId))) {
    clauses.push('t.category_id = ?');
    params.push(Number(categoryId));
  }
  if (isValidDate(from)) {
    clauses.push('t.occurred_on >= ?');
    params.push(from);
  }
  if (isValidDate(to)) {
    clauses.push('t.occurred_on <= ?');
    params.push(to);
  }
  if (minAmount && !Number.isNaN(Number(minAmount))) {
    clauses.push('t.amount_cents >= ?');
    params.push(toCents(Number(minAmount)));
  }
  if (maxAmount && !Number.isNaN(Number(maxAmount))) {
    clauses.push('t.amount_cents <= ?');
    params.push(toCents(Number(maxAmount)));
  }

  // sort/dir are validated against an allow-list above, never interpolated
  // from raw user input, so this stays injection-safe despite the template
  // literal.
  const sql = `
    SELECT t.*, c.name AS category_name, c.icon AS category_icon
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY t.${sort} ${dir}
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(sql).all(...params, limit, offset);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE ${clauses.join(' AND ')}`)
    .get(...params).n;

  res.json({ transactions: rows.map(serialize), total, limit, offset });
});

router.post(
  '/',
  validateBody({
    amount: isPositiveAmount,
    type: (v) => v === 'income' || v === 'expense',
    description: (v) => v === undefined || isNonEmptyString(v, 255),
    date: isValidDate,
  }),
  (req, res) => {
    const { amount, type, description = '', date, categoryId, isRecurring, recurringInterval } = req.body;

    if (categoryId !== undefined && categoryId !== null) {
      const cat = db
        .prepare('SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)')
        .get(categoryId, req.userId);
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const recurring = !!isRecurring;
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(recurringInterval)
      ? recurringInterval
      : null;

    const info = db
      .prepare(
        `INSERT INTO transactions
           (user_id, category_id, amount_cents, type, description, occurred_on, is_recurring, recurring_interval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.userId, categoryId || null, toCents(amount), type, description.trim(), date, recurring ? 1 : 0, interval);

    const row = db
      .prepare(
        `SELECT t.*, c.name AS category_name, c.icon AS category_icon
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.id = ?`
      )
      .get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  }
);

router.put(
  '/:id',
  validateBody({
    amount: isPositiveAmount,
    type: (v) => v === 'income' || v === 'expense',
    description: (v) => v === undefined || isNonEmptyString(v, 255),
    date: isValidDate,
  }),
  (req, res) => {
    const { amount, type, description = '', date, categoryId, isRecurring, recurringInterval } = req.body;

    // Ownership check happens in the WHERE clause of the UPDATE itself, so
    // a user can never modify another user's transaction by guessing an id.
    const existing = db
      .prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });

    if (categoryId !== undefined && categoryId !== null) {
      const cat = db
        .prepare('SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)')
        .get(categoryId, req.userId);
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const recurring = !!isRecurring;
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(recurringInterval)
      ? recurringInterval
      : null;

    db.prepare(
      `UPDATE transactions
       SET amount_cents = ?, type = ?, description = ?, occurred_on = ?,
           category_id = ?, is_recurring = ?, recurring_interval = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(toCents(amount), type, description.trim(), date, categoryId || null, recurring ? 1 : 0, interval, req.params.id, req.userId);

    const row = db
      .prepare(
        `SELECT t.*, c.name AS category_name, c.icon AS category_icon
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.id = ?`
      )
      .get(req.params.id);
    res.json(serialize(row));
  }
);

router.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Transaction not found' });
  res.status(204).end();
});

module.exports = router;
