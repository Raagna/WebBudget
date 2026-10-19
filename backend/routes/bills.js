const express = require('express');
const { query, queryOne, run, withTransaction } = require('../db');
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
    profileId: row.profile_id,
  };
}

// Bills belong to a profile, same as transactions (migration 004), so the
// access rules match routes/transactions.js: any active member of the
// profile can see and manage its bills, and a bill id from a profile the
// caller isn't part of is a 404, not someone else's data.
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

async function requireBillAccess(req, res, billId) {
  const row = await queryOne(
    `SELECT b.* FROM bills b
     JOIN profile_members pm ON pm.profile_id = b.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE b.id = ?`,
    [req.userId, billId]
  );
  if (!row) {
    res.status(404).json({ error: 'Bill not found' });
    return null;
  }
  return row;
}

// Same visibility rule as transactions: shared defaults plus the caller's
// own categories. Returns false (and has sent a 400) for anything else.
async function checkCategory(req, res, categoryId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return true;
  // A non-numeric id used to reach Postgres as-is and fail there with a 500.
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

async function loadBill(id) {
  const row = await queryOne(
    `SELECT b.*, c.name AS category_name FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.id = ?`,
    [id]
  );
  return serialize(row);
}

// GET /api/bills?profileId=  - every bill in the profile, soonest due first.
// The page splits them into overdue / upcoming / paid itself.
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res, req.query.profileId);
  if (profileId === null) return;

  const rows = await query(
    `SELECT b.*, c.name AS category_name FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.profile_id = ? ORDER BY b.due_on ASC, b.id ASC`,
    [profileId]
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
    const profileId = await requireOwnedProfile(req, res, req.body.profileId);
    if (profileId === null) return;

    const { name, amount, dueOn, categoryId, isRecurring } = req.body;
    if (!(await checkCategory(req, res, categoryId))) return;

    const inserted = await queryOne(
      `INSERT INTO bills (user_id, profile_id, category_id, name, amount_cents, due_on, is_paid, is_recurring)
       VALUES (?, ?, ?, ?, ?, ?, FALSE, ?) RETURNING id`,
      [req.userId, profileId, categoryId || null, name.trim(), toCents(amount), dueOn, !!isRecurring]
    );
    res.status(201).json(await loadBill(inserted.id));
  })
);

router.put(
  '/:id',
  validateBody({
    name: (v) => v === undefined || isNonEmptyString(v, 100),
    amount: (v) => v === undefined || isPositiveAmount(v),
    dueOn: (v) => v === undefined || isValidDate(v),
  }),
  asyncHandler(async (req, res) => {
    const bill = await requireBillAccess(req, res, req.params.id);
    if (bill === null) return;

    const { name, amount, dueOn, isPaid, isRecurring, categoryId } = req.body;
    if (!(await checkCategory(req, res, categoryId))) return;

    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name.trim()); }
    if (amount !== undefined) { fields.push('amount_cents = ?'); params.push(toCents(amount)); }
    if (dueOn !== undefined) { fields.push('due_on = ?'); params.push(dueOn); }
    if (isPaid !== undefined) { fields.push('is_paid = ?'); params.push(!!isPaid); }
    if (isRecurring !== undefined) { fields.push('is_recurring = ?'); params.push(!!isRecurring); }
    if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }

    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    await run(`UPDATE bills SET ${fields.join(', ')} WHERE id = ?`, [...params, bill.id]);
    res.json(await loadBill(bill.id));
  })
);

// POST /api/bills/:id/pay  { expense?: { amount, date, description?, categoryId? } }
// Marks the bill paid and, when `expense` is given, records the payment as
// an expense transaction in the bill's profile - both in one database
// transaction, so a failure never leaves a paid bill without its expense
// (or an expense for a bill that still shows as unpaid and gets paid twice).
router.post('/:id/pay', asyncHandler(async (req, res) => {
  const bill = await requireBillAccess(req, res, req.params.id);
  if (bill === null) return;
  if (bill.is_paid) return res.status(409).json({ error: 'This bill is already marked paid' });

  const expense = req.body.expense;
  if (expense !== undefined && expense !== null) {
    const bad = [];
    if (typeof expense !== 'object') bad.push('expense');
    else {
      if (!isPositiveAmount(expense.amount)) bad.push('expense.amount');
      if (!isValidDate(expense.date)) bad.push('expense.date');
      if (expense.description !== undefined && !isNonEmptyString(expense.description, 255)) bad.push('expense.description');
    }
    if (bad.length) return res.status(400).json({ error: 'Invalid input', fields: bad });
    if (!(await checkCategory(req, res, expense.categoryId))) return;
  }

  const transactionId = await withTransaction(async (tx) => {
    // Conditional update: if two people pay the same shared bill at once,
    // only one of them gets to add the expense.
    const updated = await tx.run('UPDATE bills SET is_paid = TRUE WHERE id = ? AND is_paid = FALSE', [bill.id]);
    if (updated.rowCount === 0) return undefined;
    if (!expense) return null;
    const inserted = await tx.queryOne(
      `INSERT INTO transactions (user_id, profile_id, category_id, amount_cents, type, description, occurred_on)
       VALUES (?, ?, ?, ?, 'expense', ?, ?) RETURNING id`,
      [
        req.userId,
        bill.profile_id,
        expense.categoryId || null,
        toCents(expense.amount),
        (expense.description ?? bill.name).trim(),
        expense.date,
      ]
    );
    return inserted.id;
  });
  if (transactionId === undefined) return res.status(409).json({ error: 'This bill is already marked paid' });

  res.json({ bill: await loadBill(bill.id), transactionId });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const bill = await requireBillAccess(req, res, req.params.id);
  if (bill === null) return;

  await run('DELETE FROM bills WHERE id = ?', [bill.id]);
  res.status(204).end();
}));

module.exports = router;
