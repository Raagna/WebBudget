const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isPositiveAmount, toCents, fromCents } = require('../middleware/validate');
const { userToday } = require('../utils/period');
const { comparePlans, monthlyInterest, minimumTooLow, addMonths } = require('../utils/payoff');

// A profile's own loans and credit cards, and the plan for paying them
// off. (The household "who owes what" tab is routes/debts.js.) Same
// membership rule as budgets: any active member of a profile can see and
// change its plan. The arithmetic is utils/payoff.js.

const router = express.Router();
router.use(requireAuth);

const MAX_DEBTS = 50;
const MAX_RATE = 100; // percent a year
const STRATEGIES = ['avalanche', 'snowball'];

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

// The fields of one debt from a request body, or { error }.
function readDebt(body) {
  const { name, balance, rate, minPayment } = body;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 80) {
    return { error: 'Give the debt a name, like "TD Visa" or "OSAP".' };
  }
  if (!isPositiveAmount(balance)) return { error: 'Enter what you still owe, more than zero.' };
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
    return { error: `Enter the yearly interest rate as a percent, from 0 to ${MAX_RATE}.` };
  }
  if (!(minPayment === 0 || isPositiveAmount(minPayment))) return { error: 'Enter the minimum monthly payment, zero or more.' };
  return { name: name.trim(), balanceCents: toCents(balance), rateBps: Math.round(rate * 100), minPaymentCents: toCents(minPayment) };
}

// GET /api/payoff?profileId=&today=YYYY-MM-DD
// The debts as entered, and all three plans worked out from today's
// balances. The first payment is next month.
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.query.profileId);
  if (profileId === null) return;
  const thisMonth = userToday(req).slice(0, 7);

  const rows = await query(
    `SELECT id, name, balance_cents, rate_bps, min_payment_cents FROM payoff_debts
     WHERE profile_id = ? ORDER BY created_at, id`,
    [profileId]
  );
  const settings = await queryOne(`SELECT extra_cents, strategy FROM payoff_settings WHERE profile_id = ?`, [profileId]);
  const extraCents = settings ? Number(settings.extra_cents) : 0;

  const debts = rows.map((r) => ({
    id: r.id,
    name: r.name,
    balanceCents: Number(r.balance_cents),
    rateBps: r.rate_bps,
    minPaymentCents: Number(r.min_payment_cents),
  }));
  const names = new Map(debts.map((d) => [d.id, d.name]));
  const compared = comparePlans(debts, extraCents);

  const plan = (p) => ({
    paidOff: p.paidOff,
    months: p.months,
    debtFreeMonth: p.paidOff ? addMonths(thisMonth, p.months) : null,
    totalInterest: fromCents(p.totalInterestCents),
    totalPaid: fromCents(p.totalPaidCents),
    order: p.order.map((o) => ({ id: o.id, name: names.get(o.id), months: o.month, month: addMonths(thisMonth, o.month) })),
    unpaid: p.unpaid.map((id) => ({ id, name: names.get(id) })),
    balances: p.timeline.map(fromCents), // balances[0] is today
  });

  res.json({
    thisMonth,
    extra: fromCents(extraCents),
    strategy: settings?.strategy || 'avalanche',
    debts: debts.map((d) => ({
      id: d.id,
      name: d.name,
      balance: fromCents(d.balanceCents),
      rate: d.rateBps / 100,
      minPayment: fromCents(d.minPaymentCents),
      monthlyInterest: fromCents(monthlyInterest(d.balanceCents, d.rateBps)),
      minimumTooLow: minimumTooLow(d),
    })),
    totals: {
      balance: fromCents(debts.reduce((s, d) => s + d.balanceCents, 0)),
      minPayments: fromCents(debts.reduce((s, d) => s + d.minPaymentCents, 0)),
    },
    plans: {
      avalanche: plan(compared.avalanche),
      snowball: plan(compared.snowball),
      minimum: plan(compared.minimum),
    },
  });
}));

// POST /api/payoff/debts { profileId, name, balance, rate, minPayment }
// rate is the yearly percent (19.99), amounts are dollars.
router.post('/debts', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.body.profileId);
  if (profileId === null) return;
  const d = readDebt(req.body);
  if (d.error) return res.status(400).json({ error: d.error });

  const count = await queryOne(`SELECT COUNT(*)::int AS n FROM payoff_debts WHERE profile_id = ?`, [profileId]);
  if (count.n >= MAX_DEBTS) return res.status(400).json({ error: `A plan can hold up to ${MAX_DEBTS} debts.` });

  const row = await queryOne(
    `INSERT INTO payoff_debts (profile_id, name, balance_cents, rate_bps, min_payment_cents, created_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [profileId, d.name, d.balanceCents, d.rateBps, d.minPaymentCents, req.userId]
  );
  res.status(201).json({ id: row.id });
}));

// PUT /api/payoff/debts/:id { name, balance, rate, minPayment }
// For keeping a balance up to date as it's paid down.
router.put('/debts/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Debt not found' });
  const d = readDebt(req.body);
  if (d.error) return res.status(400).json({ error: d.error });
  const result = await run(
    `UPDATE payoff_debts p
     SET name = ?, balance_cents = ?, rate_bps = ?, min_payment_cents = ?, updated_at = NOW()
     WHERE p.id = ?
       AND EXISTS (SELECT 1 FROM profile_members pm
                   WHERE pm.profile_id = p.profile_id AND pm.user_id = ? AND pm.status = 'active')`,
    [d.name, d.balanceCents, d.rateBps, d.minPaymentCents, id, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Debt not found' });
  res.json({ id });
}));

router.delete('/debts/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Debt not found' });
  const result = await run(
    `DELETE FROM payoff_debts p
     WHERE p.id = ?
       AND EXISTS (SELECT 1 FROM profile_members pm
                   WHERE pm.profile_id = p.profile_id AND pm.user_id = ? AND pm.status = 'active')`,
    [id, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Debt not found' });
  res.status(204).end();
}));

// PUT /api/payoff/settings { profileId, extra?, strategy? }
// Either or both: the extra put toward debt each month, and the plan
// ('avalanche' or 'snowball') the page and dashboard show.
router.put('/settings', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.body.profileId);
  if (profileId === null) return;
  const { extra, strategy } = req.body;
  if (extra === undefined && strategy === undefined) return res.status(400).json({ error: 'Nothing to change.' });
  if (extra !== undefined && !(extra === 0 || isPositiveAmount(extra))) {
    return res.status(400).json({ error: 'Enter an extra amount of zero or more.' });
  }
  if (strategy !== undefined && !STRATEGIES.includes(strategy)) {
    return res.status(400).json({ error: "Pick 'avalanche' or 'snowball'." });
  }
  const saved = await queryOne(
    `INSERT INTO payoff_settings (profile_id, extra_cents, strategy)
     VALUES (?, COALESCE(?, 0), COALESCE(?, 'avalanche'))
     ON CONFLICT (profile_id) DO UPDATE SET
       extra_cents = COALESCE(?, payoff_settings.extra_cents),
       strategy = COALESCE(?, payoff_settings.strategy),
       updated_at = NOW()
     RETURNING extra_cents, strategy`,
    [profileId, extra === undefined ? null : toCents(extra), strategy ?? null,
     extra === undefined ? null : toCents(extra), strategy ?? null]
  );
  res.json({ extra: fromCents(Number(saved.extra_cents)), strategy: saved.strategy });
}));

module.exports = router;
