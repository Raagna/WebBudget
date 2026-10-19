const express = require('express');
const { query, queryOne, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isValidDate, isPositiveAmount, toCents, fromCents } = require('../middleware/validate');
const { splitEqually, netBalances, settleUp } = require('../utils/debts');

// A household's running tab: shared costs, paybacks, and who owes whom.
// Same membership rule as everything else in a profile - any active
// member can see the tab and add to it. The arithmetic is utils/debts.js.

const router = express.Router();
router.use(requireAuth);

const HISTORY_LIMIT = 300;

async function requireMember(req, res, profileIdRaw) {
  const profileId = Number(profileIdRaw);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    res.status(400).json({ error: 'A valid profileId is required' });
    return null;
  }
  const member = await queryOne(
    `SELECT role FROM profile_members WHERE profile_id = ? AND user_id = ? AND status = 'active'`,
    [profileId, req.userId]
  );
  if (!member) {
    res.status(404).json({ error: 'Profile not found' });
    return null;
  }
  return { profileId, role: member.role };
}

async function activeMembers(profileId) {
  return query(
    `SELECT u.id, u.name FROM profile_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.profile_id = ? AND pm.status = 'active' ORDER BY pm.created_at, u.id`,
    [profileId]
  );
}

// Every entry with its shares, oldest first (the balance needs them all;
// the history the page shows is the newest HISTORY_LIMIT).
async function loadEntries(profileId) {
  const debts = await query(
    `SELECT id, kind, description, amount_cents, paid_by, occurred_on, created_by, created_at
     FROM debts WHERE profile_id = ? ORDER BY occurred_on, id`,
    [profileId]
  );
  if (debts.length === 0) return [];
  const shares = await query(
    `SELECT debt_id, user_id, amount_cents FROM debt_shares WHERE debt_id = ANY(?) ORDER BY id`,
    [debts.map((d) => d.id)]
  );
  const byDebt = new Map(debts.map((d) => [d.id, []]));
  for (const s of shares) byDebt.get(s.debt_id).push({ userId: s.user_id, amountCents: Number(s.amount_cents) });
  return debts.map((d) => ({
    id: d.id,
    kind: d.kind,
    description: d.description,
    amountCents: Number(d.amount_cents),
    paidBy: d.paid_by,
    date: d.occurred_on,
    createdBy: d.created_by,
    shares: byDebt.get(d.id),
  }));
}

// GET /api/debts?profileId=
router.get('/', asyncHandler(async (req, res) => {
  const access = await requireMember(req, res, req.query.profileId);
  if (!access) return;
  const { profileId } = access;

  const members = await activeMembers(profileId);
  const entries = await loadEntries(profileId);
  const net = netBalances(entries);

  // Names for people on the tab who have since left the household.
  const memberIds = new Set(members.map((m) => m.id));
  const others = [...net.keys()].filter((id) => id !== null && !memberIds.has(id));
  const formerRows = others.length ? await query(`SELECT id, name FROM users WHERE id = ANY(?)`, [others]) : [];
  const people = new Map([
    ...members.map((m) => [m.id, { id: m.id, name: m.name, member: true }]),
    ...formerRows.map((u) => [u.id, { id: u.id, name: u.name, member: false }]),
  ]);
  const nameOf = (id) => (id === null ? 'Former member' : people.get(id)?.name || 'Former member');

  const balances = [...people.values()].map((p) => ({ ...p, net: fromCents(net.get(p.id) || 0) }));
  if (net.get(null)) balances.push({ id: null, name: 'Former member', member: false, net: fromCents(net.get(null)) });

  res.json({
    members: members.map((m) => ({ id: m.id, name: m.name })),
    you: req.userId,
    yourNet: fromCents(net.get(req.userId) || 0),
    balances,
    settleUp: settleUp(net).map((p) => ({
      from: p.from, fromName: nameOf(p.from), to: p.to, toName: nameOf(p.to), amount: fromCents(p.amountCents),
    })),
    entries: entries.slice(-HISTORY_LIMIT).reverse().map((e) => ({
      id: e.id,
      kind: e.kind,
      description: e.description,
      amount: fromCents(e.amountCents),
      date: e.date,
      paidBy: e.paidBy,
      paidByName: nameOf(e.paidBy),
      shares: e.shares.map((s) => ({ userId: s.userId, name: nameOf(s.userId), amount: fromCents(s.amountCents) })),
      canDelete: e.createdBy === req.userId || access.role === 'owner',
    })),
  });
}));

async function insertEntry({ profileId, kind, description, amountCents, paidBy, date, shares, userId }) {
  return withTransaction(async (tx) => {
    const row = await tx.queryOne(
      `INSERT INTO debts (profile_id, kind, description, amount_cents, paid_by, occurred_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [profileId, kind, description, amountCents, paidBy, date, userId]
    );
    for (const s of shares) {
      await tx.run(`INSERT INTO debt_shares (debt_id, user_id, amount_cents) VALUES (?, ?, ?)`, [row.id, s.userId, s.amountCents]);
    }
    return row.id;
  });
}

// POST /api/debts  a shared cost
// { profileId, description, amount, date, paidBy,
//   split: 'equal', between: [userIds] }  or
//   split: 'custom', shares: [{ userId, amount }] }
router.post('/', asyncHandler(async (req, res) => {
  const access = await requireMember(req, res, req.body.profileId);
  if (!access) return;
  const { profileId } = access;
  const { description = '', amount, date, paidBy, split } = req.body;

  if (typeof description !== 'string' || description.trim().length === 0 || description.length > 200) {
    return res.status(400).json({ error: 'Say what it was for.' });
  }
  if (!isPositiveAmount(amount)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Pick a date.' });
  const memberIds = new Set((await activeMembers(profileId)).map((m) => m.id));
  if (!memberIds.has(paidBy)) return res.status(400).json({ error: 'Whoever paid must be in this household.' });

  const amountCents = toCents(amount);
  let shares;
  if (split === 'equal') {
    const between = Array.isArray(req.body.between) ? [...new Set(req.body.between)] : [];
    if (between.length === 0) return res.status(400).json({ error: 'Pick who it was for.' });
    if (!between.every((id) => memberIds.has(id))) return res.status(400).json({ error: 'Everyone it was for must be in this household.' });
    shares = splitEqually(amountCents, between);
  } else if (split === 'custom') {
    const list = Array.isArray(req.body.shares) ? req.body.shares : [];
    const ids = list.map((s) => s?.userId);
    if (list.length === 0 || new Set(ids).size !== ids.length || !ids.every((id) => memberIds.has(id))) {
      return res.status(400).json({ error: 'Each share must be for a different member of this household.' });
    }
    if (!list.every((s) => s.amount === 0 || isPositiveAmount(s.amount))) {
      return res.status(400).json({ error: 'Shares must be zero or more.' });
    }
    shares = list.map((s) => ({ userId: s.userId, amountCents: toCents(s.amount) }));
    const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
    if (total !== amountCents) {
      return res.status(400).json({ error: `The shares add up to ${fromCents(total).toFixed(2)}, not ${fromCents(amountCents).toFixed(2)}.` });
    }
  } else {
    return res.status(400).json({ error: "Split it 'equal' or 'custom'." });
  }

  const id = await insertEntry({
    profileId, kind: 'expense', description: description.trim(), amountCents, paidBy, date, shares, userId: req.userId,
  });
  res.status(201).json({ id });
}));

// POST /api/debts/payments  someone paying someone back
// { profileId, from, to, amount, date, note? }
router.post('/payments', asyncHandler(async (req, res) => {
  const access = await requireMember(req, res, req.body.profileId);
  if (!access) return;
  const { profileId } = access;
  const { from, to, amount, date, note = '' } = req.body;
  const memberIds = new Set((await activeMembers(profileId)).map((m) => m.id));
  if (!memberIds.has(from) || !memberIds.has(to) || from === to) {
    return res.status(400).json({ error: 'Pick two different people in this household.' });
  }
  if (!isPositiveAmount(amount)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Pick a date.' });
  if (typeof note !== 'string' || note.length > 200) return res.status(400).json({ error: 'Keep the note under 200 characters.' });

  const amountCents = toCents(amount);
  const id = await insertEntry({
    profileId, kind: 'payment', description: note.trim(), amountCents, paidBy: from, date,
    shares: [{ userId: to, amountCents }], userId: req.userId,
  });
  res.status(201).json({ id });
}));

// DELETE /api/debts/:id  - by whoever added it, or the household's owner.
router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await queryOne(
    `SELECT d.id, d.created_by, pm.role FROM debts d
     JOIN profile_members pm ON pm.profile_id = d.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE d.id = ?`,
    [req.userId, Number(req.params.id) || 0]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.created_by !== req.userId && row.role !== 'owner') {
    return res.status(403).json({ error: 'Only whoever added this, or the household owner, can delete it.' });
  }
  await query(`DELETE FROM debts WHERE id = ?`, [row.id]);
  res.status(204).end();
}));

module.exports = router;
