const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isValidDate, toCents, fromCents } = require('../middleware/validate');
const { userToday } = require('../utils/period');
const { getQuotes, getRates } = require('../utils/quotes');

// Accounts and net worth: what a profile owns minus what it owes, now and
// month by month. Balances are whatever the user last entered (see
// migration 016); investments come in at their live value.

const router = express.Router();
router.use(requireAuth);

const ASSET_KINDS = ['chequing', 'savings', 'cash', 'property', 'other_asset'];
const DEBT_KINDS = ['credit_card', 'loan', 'mortgage', 'other_debt'];
const KINDS = new Set([...ASSET_KINDS, ...DEBT_KINDS]);
const HISTORY_MONTHS = 12;
const MAX_BALANCE = 1_000_000_000; // a billion: room for a house, not for typos with extra zeros

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

async function requireAccount(req, res, idRaw) {
  const row = await queryOne(
    `SELECT a.* FROM accounts a
     JOIN profile_members pm ON pm.profile_id = a.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE a.id = ?`,
    [req.userId, Number(idRaw) || 0]
  );
  if (!row) {
    res.status(404).json({ error: 'Account not found' });
    return null;
  }
  return row;
}

const isBalance = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_BALANCE;
const isName = (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 80;

// What the profile's holdings are worth right now, in its currency, or
// null when it has none (or none can be priced).
async function portfolioCents(profileId, currency) {
  const rows = await query(`SELECT symbol, shares FROM holdings WHERE profile_id = ?`, [profileId]);
  if (rows.length === 0) return null;
  const quotes = await getQuotes(rows.map((r) => r.symbol));
  const rates = await getRates([...quotes.values()].map((q) => q.currency), currency);
  let cents = 0;
  let priced = 0;
  for (const r of rows) {
    const q = quotes.get(r.symbol);
    const rate = q ? rates.get(q.currency) : undefined;
    if (!q || rate === undefined) continue;
    cents += Math.round(Number(r.shares) * q.price * rate * 100);
    priced++;
  }
  return priced ? cents : null;
}

// YYYY-MM for the last n months, oldest first, ending with today's.
function lastMonths(today, n) {
  const [y, m] = today.split('-').map(Number);
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function monthEnd(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// The latest value on or before `date` from rows sorted by as_of.
function valueOn(rows, date) {
  let v;
  for (const r of rows) {
    if (r.as_of > date) break;
    v = r;
  }
  return v;
}

// GET /api/networth?profileId=&today=
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.query.profileId);
  if (profileId === null) return;
  const today = userToday(req);
  const { currency } = await queryOne(`SELECT currency FROM profiles WHERE id = ?`, [profileId]);

  const accounts = await query(`SELECT id, name, kind FROM accounts WHERE profile_id = ? ORDER BY created_at, id`, [profileId]);
  const balances = accounts.length === 0 ? [] : await query(
    `SELECT account_id, as_of, balance_cents FROM account_balances WHERE account_id = ANY(?) ORDER BY as_of`,
    [accounts.map((a) => a.id)]
  );
  const byAccount = new Map(accounts.map((a) => [a.id, []]));
  for (const b of balances) byAccount.get(b.account_id).push({ as_of: b.as_of, cents: Number(b.balance_cents) });

  // Today's portfolio value, recorded once a day so it has a history.
  const investCents = await portfolioCents(profileId, currency || 'USD');
  if (investCents !== null) {
    await run(
      `INSERT INTO investment_snapshots (profile_id, as_of, value_cents) VALUES (?, ?, ?)
       ON CONFLICT (profile_id, as_of) DO UPDATE SET value_cents = EXCLUDED.value_cents`,
      [profileId, today, investCents]
    );
  }
  const snapshots = (await query(
    `SELECT as_of, value_cents FROM investment_snapshots WHERE profile_id = ? AND as_of <= ? ORDER BY as_of`,
    [profileId, today]
  )).map((s) => ({ as_of: s.as_of, cents: Number(s.value_cents) }));

  // Assets add, debts subtract; an account with no balance yet on a date
  // doesn't count on that date.
  function totalsOn(date) {
    let assets = 0;
    let debts = 0;
    for (const a of accounts) {
      const v = valueOn(byAccount.get(a.id), date);
      if (!v) continue;
      if (DEBT_KINDS.includes(a.kind)) debts += v.cents; else assets += v.cents;
    }
    const inv = date === today && investCents !== null ? { cents: investCents } : valueOn(snapshots, date);
    if (inv) assets += inv.cents;
    return { assets, debts, net: assets - debts };
  }

  const now = totalsOn(today);
  const history = lastMonths(today, HISTORY_MONTHS).map((month) => {
    const end = monthEnd(month);
    const t = totalsOn(end < today ? end : today);
    return { month, netWorth: fromCents(t.net), assets: fromCents(t.assets), debts: fromCents(t.debts) };
  });
  // Months before anything was recorded aren't "zero net worth"; leave
  // them out so the chart starts where the data does.
  const firstRecorded = history.findIndex((h) => h.assets !== 0 || h.debts !== 0);

  const lastMonth = totalsOn(monthEnd(lastMonths(today, 2)[0]));
  const hadLastMonth = lastMonth.assets !== 0 || lastMonth.debts !== 0;

  res.json({
    currency,
    accounts: accounts.map((a) => {
      const latest = byAccount.get(a.id).at(-1);
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        debt: DEBT_KINDS.includes(a.kind),
        balance: latest ? fromCents(latest.cents) : null,
        asOf: latest ? latest.as_of : null,
      };
    }),
    investments: investCents === null ? null : fromCents(investCents),
    totals: { assets: fromCents(now.assets), debts: fromCents(now.debts), netWorth: fromCents(now.net) },
    changeSinceLastMonth: hadLastMonth ? fromCents(now.net - lastMonth.net) : null,
    history: firstRecorded === -1 ? [] : history.slice(firstRecorded),
  });
}));

// POST /api/networth/accounts  { profileId, name, kind, balance, asOf? }
router.post('/accounts', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.body.profileId);
  if (profileId === null) return;
  const { name, kind, balance } = req.body;
  const asOf = req.body.asOf || userToday(req);
  if (!isName(name)) return res.status(400).json({ error: 'Give the account a name.' });
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'Pick what kind of account it is.' });
  if (!isBalance(balance)) return res.status(400).json({ error: 'Enter the balance.' });
  if (!isValidDate(asOf)) return res.status(400).json({ error: 'That date isn’t a real date.' });
  const row = await queryOne(
    `INSERT INTO accounts (profile_id, name, kind, created_by) VALUES (?, ?, ?, ?) RETURNING id`,
    [profileId, name.trim(), kind, req.userId]
  );
  await run(`INSERT INTO account_balances (account_id, as_of, balance_cents) VALUES (?, ?, ?)`, [row.id, asOf, toCents(balance)]);
  res.status(201).json({ id: row.id });
}));

// PUT /api/networth/accounts/:id  { name?, kind? }
router.put('/accounts/:id', asyncHandler(async (req, res) => {
  const account = await requireAccount(req, res, req.params.id);
  if (!account) return;
  const { name, kind } = req.body;
  if (name !== undefined && !isName(name)) return res.status(400).json({ error: 'Give the account a name.' });
  if (kind !== undefined && !KINDS.has(kind)) return res.status(400).json({ error: 'Pick what kind of account it is.' });
  await run(`UPDATE accounts SET name = COALESCE(?, name), kind = COALESCE(?, kind) WHERE id = ?`,
    [name === undefined ? null : name.trim(), kind ?? null, account.id]);
  res.json({ ok: true });
}));

// POST /api/networth/accounts/:id/balances  { balance, asOf? }
// A new balance; a second update on the same day replaces the first.
router.post('/accounts/:id/balances', asyncHandler(async (req, res) => {
  const account = await requireAccount(req, res, req.params.id);
  if (!account) return;
  const { balance } = req.body;
  const asOf = req.body.asOf || userToday(req);
  if (!isBalance(balance)) return res.status(400).json({ error: 'Enter the balance.' });
  if (!isValidDate(asOf)) return res.status(400).json({ error: 'That date isn’t a real date.' });
  await run(
    `INSERT INTO account_balances (account_id, as_of, balance_cents) VALUES (?, ?, ?)
     ON CONFLICT (account_id, as_of) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`,
    [account.id, asOf, toCents(balance)]
  );
  res.status(201).json({ ok: true });
}));

// DELETE /api/networth/accounts/:id  (and its balance history)
router.delete('/accounts/:id', asyncHandler(async (req, res) => {
  const account = await requireAccount(req, res, req.params.id);
  if (!account) return;
  await run(`DELETE FROM accounts WHERE id = ?`, [account.id]);
  res.status(204).end();
}));

module.exports = router;
module.exports.ASSET_KINDS = ASSET_KINDS;
module.exports.DEBT_KINDS = DEBT_KINDS;
