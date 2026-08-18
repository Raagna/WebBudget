const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  isNonEmptyString,
  isValidDate,
  isPositiveAmount,
  isIdArray,
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
    date: row.occurred_on instanceof Date ? row.occurred_on.toISOString().slice(0, 10) : row.occurred_on,
    isRecurring: !!row.is_recurring,
    recurringInterval: row.recurring_interval,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    profileId: row.profile_id,
  };
}

// Every route below operates within a single profile. This helper confirms
// the authenticated user has an active membership on the requested profile
// before any query touches it - either as the original owner or as an
// invited-and-accepted member - so a user can never read or write a
// profile they're not part of by guessing an id. Returns null (and has
// already sent a response) if the check fails.
async function requireOwnedProfile(req, res, profileIdRaw) {
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

// Given a transaction id, confirms the requester is an active member of
// the PROFILE that transaction belongs to - not just that they personally
// created it. This is what makes shared households actually collaborative:
// either partner can fix or remove a transaction the other one entered.
async function requireTransactionAccess(req, res, transactionId) {
  const row = await queryOne(
    `SELECT t.id, t.profile_id FROM transactions t
     JOIN profile_members pm ON pm.profile_id = t.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE t.id = ?`,
    [req.userId, transactionId]
  );
  if (!row) {
    res.status(404).json({ error: 'Transaction not found' });
    return null;
  }
  return row;
}

// GET /api/transactions?profileId=&type=&categoryId=&from=&to=&minAmount=&maxAmount=&sort=&dir=&limit=&offset=
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res, req.query.profileId);
  if (profileId === null) return;

  const { type, categoryId, from, to, minAmount, maxAmount } = req.query;
  const sort = SORTABLE_COLUMNS.has(req.query.sort) ? req.query.sort : 'occurred_on';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  // Filtered by profile only, NOT by who entered each transaction - every
  // active member of a shared profile sees the whole shared ledger, not
  // just the rows they personally added.
  const clauses = ['t.profile_id = ?'];
  const params = [profileId];

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
  const rows = await query(sql, [...params, limit, offset]);
  const totalRow = await queryOne(
    `SELECT COUNT(*)::int AS n FROM transactions t WHERE ${clauses.join(' AND ')}`,
    params
  );

  res.json({ transactions: rows.map(serialize), total: totalRow.n, limit, offset });
}));

router.post(
  '/',
  validateBody({
    amount: isPositiveAmount,
    type: (v) => v === 'income' || v === 'expense',
    description: (v) => v === undefined || isNonEmptyString(v, 255),
    date: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const profileId = await requireOwnedProfile(req, res, req.body.profileId);
    if (profileId === null) return;

    const { amount, type, description = '', date, categoryId, isRecurring, recurringInterval } = req.body;

    if (categoryId !== undefined && categoryId !== null) {
      const cat = await queryOne(
        'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, req.userId]
      );
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const recurring = !!isRecurring;
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(recurringInterval)
      ? recurringInterval
      : null;

    // user_id still records who actually entered it (shown nowhere in the
    // UI today, but useful history) - authorization for everything else
    // flows through profile_id + profile_members, not this column.
    const inserted = await queryOne(
      `INSERT INTO transactions
         (user_id, profile_id, category_id, amount_cents, type, description, occurred_on, is_recurring, recurring_interval)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [req.userId, profileId, categoryId || null, toCents(amount), type, description.trim(), date, recurring, interval]
    );

    const row = await queryOne(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`,
      [inserted.id]
    );
    res.status(201).json(serialize(row));
  })
);

router.put(
  '/:id',
  validateBody({
    amount: isPositiveAmount,
    type: (v) => v === 'income' || v === 'expense',
    description: (v) => v === undefined || isNonEmptyString(v, 255),
    date: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const { amount, type, description = '', date, categoryId, isRecurring, recurringInterval } = req.body;

    const access = await requireTransactionAccess(req, res, req.params.id);
    if (access === null) return;

    if (categoryId !== undefined && categoryId !== null) {
      const cat = await queryOne(
        'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, req.userId]
      );
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const recurring = !!isRecurring;
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(recurringInterval)
      ? recurringInterval
      : null;

    await run(
      `UPDATE transactions
       SET amount_cents = ?, type = ?, description = ?, occurred_on = ?,
           category_id = ?, is_recurring = ?, recurring_interval = ?, updated_at = NOW()
       WHERE id = ?`,
      [toCents(amount), type, description.trim(), date, categoryId || null, recurring, interval, req.params.id]
    );

    const row = await queryOne(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    res.json(serialize(row));
  })
);

router.delete('/:id', asyncHandler(async (req, res) => {
  const access = await requireTransactionAccess(req, res, req.params.id);
  if (access === null) return;

  await run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---------- Bulk operations (multi-select in the UI) ----------
// Both endpoints join through profile_members rather than filtering by
// user_id, so any active member of a shared profile can bulk-act on the
// whole shared ledger - but only on rows in profiles they actually belong
// to. A crafted request naming a transaction id from a profile the caller
// isn't a member of simply skips that row; the response's affected count
// reveals if some ids were skipped for that reason.

router.post(
  '/bulk-delete',
  validateBody({ ids: isIdArray }),
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    const placeholders = ids.map(() => '?').join(',');
    const result = await run(
      `DELETE FROM transactions t
       USING profile_members pm
       WHERE pm.profile_id = t.profile_id AND pm.user_id = ? AND pm.status = 'active'
         AND t.id IN (${placeholders})`,
      [req.userId, ...ids]
    );
    res.json({ deleted: result.rowCount });
  })
);

router.patch(
  '/bulk-update',
  validateBody({ ids: isIdArray }),
  asyncHandler(async (req, res) => {
    const { ids, categoryId, isRecurring } = req.body;

    if (categoryId === undefined && isRecurring === undefined) {
      return res.status(400).json({ error: 'Provide categoryId and/or isRecurring to update' });
    }
    if (categoryId !== undefined && categoryId !== null) {
      const cat = await queryOne(
        'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, req.userId]
      );
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const fields = [];
    const params = [];
    if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }
    if (isRecurring !== undefined) {
      fields.push('is_recurring = ?');
      params.push(!!isRecurring);
      if (!isRecurring) { fields.push('recurring_interval = NULL'); }
    }
    fields.push('updated_at = NOW()');

    const placeholders = ids.map(() => '?').join(',');
    const result = await run(
      `UPDATE transactions t SET ${fields.join(', ')}
       FROM profile_members pm
       WHERE pm.profile_id = t.profile_id AND pm.user_id = ? AND pm.status = 'active'
         AND t.id IN (${placeholders})`,
      [...params, req.userId, ...ids]
    );
    res.json({ updated: result.rowCount });
  })
);

module.exports = router;
