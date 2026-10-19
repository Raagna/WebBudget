const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isValidDate, isPositiveAmount, toCents, fromCents } = require('../middleware/validate');
const { userToday } = require('../utils/period');

// Savings goals: a target, an optional date, and the money put toward it.
// Same membership rule as budgets: any active member of the profile can
// see and change its goals.

const router = express.Router();
router.use(requireAuth);

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

async function requireGoal(req, res, idRaw) {
  const row = await queryOne(
    `SELECT g.* FROM savings_goals g
     JOIN profile_members pm ON pm.profile_id = g.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE g.id = ?`,
    [req.userId, Number(idRaw) || 0]
  );
  if (!row) {
    res.status(404).json({ error: 'Goal not found' });
    return null;
  }
  return row;
}

// Calendar months from today's month through the target's, counting both:
// on Oct 19 a Dec 31 target has 3 (October, November, December), since a
// monthly transfer can still go in this month.
function monthsLeft(today, targetDate) {
  const [y, m] = today.split('-').map(Number);
  const [ty, tm] = targetDate.split('-').map(Number);
  return (ty - y) * 12 + (tm - m) + 1;
}

// Where a goal stands, in plain terms the page can show as-is.
function describe(goal, savedCents, today) {
  const target = Number(goal.target_cents);
  const remaining = Math.max(0, target - savedCents);
  const out = {
    id: goal.id,
    name: goal.name,
    target: fromCents(target),
    saved: fromCents(savedCents),
    remaining: fromCents(remaining),
    percent: Math.max(0, Math.min(100, Math.round((savedCents / target) * 100))),
    targetDate: goal.target_date,
    perMonth: null,
    monthsLeft: null,
    status: 'saving',
  };
  if (remaining === 0) out.status = 'reached';
  else if (goal.target_date && goal.target_date < today) out.status = 'overdue';
  else if (goal.target_date) {
    out.monthsLeft = monthsLeft(today, goal.target_date);
    out.perMonth = fromCents(Math.ceil(remaining / out.monthsLeft));
  }
  return out;
}

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80;
}
const validTargetDate = (v) => v === undefined || v === null || v === '' || isValidDate(v);

// GET /api/goals?profileId=&today=
// -> { goals: [...], totals: { saved, target } }, unfinished goals first.
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.query.profileId);
  if (profileId === null) return;
  const today = userToday(req);
  const rows = await query(
    `SELECT g.*, COALESCE((SELECT SUM(c.amount_cents) FROM goal_contributions c WHERE c.goal_id = g.id), 0)::bigint AS saved_cents
     FROM savings_goals g WHERE g.profile_id = ?
     ORDER BY g.target_date NULLS LAST, g.created_at, g.id`,
    [profileId]
  );
  const goals = rows.map((g) => describe(g, Number(g.saved_cents), today));
  goals.sort((a, b) => (a.status === 'reached') - (b.status === 'reached'));
  res.json({
    goals,
    totals: {
      saved: fromCents(rows.reduce((s, g) => s + Math.max(0, Number(g.saved_cents)), 0)),
      target: fromCents(rows.reduce((s, g) => s + Number(g.target_cents), 0)),
    },
  });
}));

// GET /api/goals/:id/contributions -> the goal's history, newest first.
router.get('/:id/contributions', asyncHandler(async (req, res) => {
  const goal = await requireGoal(req, res, req.params.id);
  if (!goal) return;
  const rows = await query(
    `SELECT c.id, c.amount_cents, c.occurred_on, c.note, u.name AS added_by
     FROM goal_contributions c LEFT JOIN users u ON u.id = c.created_by
     WHERE c.goal_id = ? ORDER BY c.occurred_on DESC, c.id DESC LIMIT 200`,
    [goal.id]
  );
  res.json({
    contributions: rows.map((r) => ({
      id: r.id, amount: fromCents(Number(r.amount_cents)), date: r.occurred_on, note: r.note, addedBy: r.added_by || 'Former member',
    })),
  });
}));

// POST /api/goals  { profileId, name, target, targetDate?, startingAmount? }
router.post('/', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.body.profileId);
  if (profileId === null) return;
  const { name, target, targetDate, startingAmount } = req.body;
  if (!validName(name)) return res.status(400).json({ error: 'Give the goal a name.' });
  if (!isPositiveAmount(target)) return res.status(400).json({ error: 'Enter a target greater than zero.' });
  if (!validTargetDate(targetDate)) return res.status(400).json({ error: 'That target date isn’t a real date.' });
  if (startingAmount !== undefined && startingAmount !== null && startingAmount !== 0 && !isPositiveAmount(startingAmount)) {
    return res.status(400).json({ error: 'The amount already saved must be zero or more.' });
  }
  const row = await queryOne(
    `INSERT INTO savings_goals (profile_id, name, target_cents, target_date, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [profileId, name.trim(), toCents(target), targetDate || null, req.userId]
  );
  // Money already put aside before the goal existed counts from the start.
  if (isPositiveAmount(startingAmount)) {
    await run(
      `INSERT INTO goal_contributions (goal_id, amount_cents, occurred_on, note, created_by) VALUES (?, ?, ?, 'Already saved', ?)`,
      [row.id, toCents(startingAmount), userToday(req), req.userId]
    );
  }
  res.status(201).json({ id: row.id });
}));

// PUT /api/goals/:id  { name?, target?, targetDate? }
router.put('/:id', asyncHandler(async (req, res) => {
  const goal = await requireGoal(req, res, req.params.id);
  if (!goal) return;
  const { name, target, targetDate } = req.body;
  const fields = [];
  const params = [];
  if (name !== undefined) {
    if (!validName(name)) return res.status(400).json({ error: 'Give the goal a name.' });
    fields.push('name = ?'); params.push(name.trim());
  }
  if (target !== undefined) {
    if (!isPositiveAmount(target)) return res.status(400).json({ error: 'Enter a target greater than zero.' });
    fields.push('target_cents = ?'); params.push(toCents(target));
  }
  if (targetDate !== undefined) {
    if (!validTargetDate(targetDate)) return res.status(400).json({ error: 'That target date isn’t a real date.' });
    fields.push('target_date = ?'); params.push(targetDate || null);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  await run(`UPDATE savings_goals SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, [...params, goal.id]);
  res.json({ ok: true });
}));

// DELETE /api/goals/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const goal = await requireGoal(req, res, req.params.id);
  if (!goal) return;
  await run(`DELETE FROM savings_goals WHERE id = ?`, [goal.id]);
  res.status(204).end();
}));

// POST /api/goals/:id/contributions  { amount, date, note? }
// A positive amount is money put in; negative is money taken back out.
// Taking out more than is saved is refused, so a goal never goes below 0.
router.post('/:id/contributions', asyncHandler(async (req, res) => {
  const goal = await requireGoal(req, res, req.params.id);
  if (!goal) return;
  const { amount, date, note = '' } = req.body;
  if (typeof amount !== 'number' || amount === 0 || !isPositiveAmount(Math.abs(amount))) {
    return res.status(400).json({ error: 'Enter an amount.' });
  }
  if (!isValidDate(date)) return res.status(400).json({ error: 'Pick a date.' });
  if (typeof note !== 'string' || note.length > 200) return res.status(400).json({ error: 'Keep the note under 200 characters.' });
  if (amount < 0) {
    const saved = await queryOne(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s FROM goal_contributions WHERE goal_id = ?`, [goal.id]);
    if (toCents(-amount) > Number(saved.s)) {
      return res.status(400).json({ error: `Only ${fromCents(Number(saved.s)).toFixed(2)} is saved toward this goal.` });
    }
  }
  const row = await queryOne(
    `INSERT INTO goal_contributions (goal_id, amount_cents, occurred_on, note, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [goal.id, toCents(amount), date, note.trim(), req.userId]
  );
  res.status(201).json({ id: row.id });
}));

// DELETE /api/goals/:id/contributions/:contributionId
router.delete('/:id/contributions/:contributionId', asyncHandler(async (req, res) => {
  const goal = await requireGoal(req, res, req.params.id);
  if (!goal) return;
  const result = await run(`DELETE FROM goal_contributions WHERE id = ? AND goal_id = ?`, [Number(req.params.contributionId) || 0, goal.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
}));

module.exports = router;
module.exports.monthsLeft = monthsLeft;
