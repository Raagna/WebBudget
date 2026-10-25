const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isPositiveAmount, toCents, fromCents, validateBody } = require('../middleware/validate');
const { normalizeSymbol, getQuotes, getRates, fetchQuote, saveQuote, QuoteNotFound } = require('../utils/quotes');
const { parseWealthsimpleHoldings, HoldingsImportError } = require('../utils/holdingsImport');
const { applyHoldings, syncSnapTrade } = require('../utils/holdingSync');
const snaptrade = require('../utils/snaptrade');

const router = express.Router();
router.use(requireAuth);

// Same membership rule as transactions and budgets: any active member of
// a profile can see and change its holdings.
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

async function requireHolding(req, res, idRaw) {
  const row = await queryOne(
    `SELECT h.* FROM holdings h
     JOIN profile_members pm ON pm.profile_id = h.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE h.id = ?`,
    [req.userId, Number(idRaw) || 0]
  );
  if (!row) {
    res.status(404).json({ error: 'Holding not found' });
    return null;
  }
  return row;
}

// Up to a billion shares, with at most 8 decimals (what the column keeps).
function isShares(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e9;
}
// Book cost is optional: blank/null clears it, 0 is allowed (gifted shares).
const isOptionalCost = (v) => v === undefined || v === null || v === '' || v === 0 || isPositiveAmount(v);
const isAccount = (v) => v === undefined || (typeof v === 'string' && v.trim().length <= 80);

const SYMBOL_HELP = 'Use the symbol as Yahoo Finance shows it: US stocks as is (AAPL), Toronto listings end in .TO (XEQT.TO), crypto like BTC-CAD.';

// Checks a new symbol exists before saving it, so a typo is caught now
// rather than showing up later as a holding with no price. When the
// price source is unreachable the holding is saved anyway - it will price
// once the source is back.
async function checkSymbol(symbol) {
  try {
    const q = await fetchQuote(symbol);
    await saveQuote(q);
    return { ok: true };
  } catch (err) {
    if (err instanceof QuoteNotFound) return { ok: false };
    console.error(`[investments] could not check ${symbol}:`, err.message);
    return { ok: true };
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

// GET /api/investments?profileId=
// Every holding with its live (or last known) price, converted into the
// profile's currency, plus portfolio totals. A holding that can't be
// priced or converted is listed with value null and left out of totals.
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.query.profileId);
  if (profileId === null) return;

  const profile = await queryOne(`SELECT currency FROM profiles WHERE id = ?`, [profileId]);
  const target = profile.currency || 'USD';
  const rows = await query(
    `SELECT id, symbol, account, shares, book_cost_cents, source FROM holdings WHERE profile_id = ? ORDER BY symbol, account, id`,
    [profileId]
  );
  const quotes = await getQuotes(rows.map((r) => r.symbol));
  const rates = await getRates([...quotes.values()].map((q) => q.currency), target);

  const totals = { value: 0, dayChange: 0, bookCost: 0, gain: 0, priced: 0, withCost: 0 };
  let asOf = null;
  let stale = false;
  const holdings = rows.map((r) => {
    const shares = Number(r.shares);
    const q = quotes.get(r.symbol);
    const rate = q ? rates.get(q.currency) : undefined;
    const bookCost = r.book_cost_cents === null ? null : fromCents(Number(r.book_cost_cents));
    let value = null;
    let dayChange = null;
    let gain = null;
    if (q && rate !== undefined) {
      value = round2(shares * q.price * rate);
      dayChange = q.previousClose === null ? null : round2(shares * (q.price - q.previousClose) * rate);
      if (bookCost !== null) gain = round2(value - bookCost);
      totals.value += value;
      totals.priced++;
      if (dayChange !== null) totals.dayChange += dayChange;
      if (gain !== null) { totals.gain += gain; totals.bookCost += bookCost; totals.withCost++; }
      if (q.stale) stale = true;
      if (!asOf || new Date(q.asOf) < new Date(asOf)) asOf = q.asOf; // oldest price shown
    }
    return {
      id: r.id,
      symbol: r.symbol,
      name: q?.name || r.symbol,
      account: r.account,
      source: r.source,
      shares,
      currency: q?.currency || null,
      price: q ? q.price : null,
      previousClose: q ? q.previousClose : null,
      value,
      dayChange,
      bookCost,
      gain,
      stale: q ? q.stale : true,
    };
  });

  res.json({
    currency: target,
    holdings,
    totals: {
      value: round2(totals.value),
      dayChange: round2(totals.dayChange),
      // Gain only covers holdings with a book cost, so it's reported
      // alongside the book cost it was measured against.
      bookCost: round2(totals.bookCost),
      gain: totals.withCost ? round2(totals.gain) : null,
      unpriced: rows.length - totals.priced,
    },
    asOf,
    stale,
    sources: await sourcesFor(req, profileId),
  });
}));

// When this profile last imported a Wealthsimple report / synced SnapTrade,
// and whether this login can sync (see utils/snaptrade.js).
async function sourcesFor(req, profileId) {
  const rows = await query(`SELECT source, synced_at, as_of FROM holding_syncs WHERE profile_id = ?`, [profileId]);
  const bySource = new Map(rows.map((r) => [r.source, { syncedAt: r.synced_at, asOf: r.as_of }]));
  const user = await queryOne(`SELECT email FROM users WHERE id = ?`, [req.userId]);
  return {
    wealthsimpleCsv: bySource.get('wealthsimple_csv') || null,
    snaptrade: { ...snaptrade.availability(user?.email), last: bySource.get('snaptrade') || null },
  };
}

// POST /api/investments  { profileId, symbol, shares, account?, bookCost? }
router.post(
  '/',
  validateBody({ shares: isShares, account: isAccount, bookCost: isOptionalCost }),
  asyncHandler(async (req, res) => {
    const profileId = await requireMember(req, res, req.body.profileId);
    if (profileId === null) return;
    const symbol = normalizeSymbol(req.body.symbol);
    if (!symbol) return res.status(400).json({ error: `Enter a valid symbol. ${SYMBOL_HELP}` });
    if (!(await checkSymbol(symbol)).ok) {
      return res.status(400).json({ error: `Couldn't find "${symbol}". ${SYMBOL_HELP}` });
    }
    const { bookCost } = req.body;
    const row = await queryOne(
      `INSERT INTO holdings (profile_id, symbol, account, shares, book_cost_cents, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [profileId, symbol, (req.body.account || '').trim(), req.body.shares,
        typeof bookCost === 'number' ? toCents(bookCost) : null, req.userId]
    );
    res.status(201).json({ id: row.id, symbol });
  })
);

// PUT /api/investments/:id  { shares?, account?, bookCost? }
// The symbol can't change: a different symbol is a different holding.
router.put(
  '/:id',
  validateBody({ shares: (v) => v === undefined || isShares(v), account: isAccount, bookCost: isOptionalCost }),
  asyncHandler(async (req, res) => {
    const holding = await requireHolding(req, res, req.params.id);
    if (!holding) return;
    if (holding.source !== 'manual') {
      return res.status(409).json({ error: 'This holding comes from Wealthsimple, so the next import or sync would undo an edit. Change it there instead.' });
    }
    const fields = [];
    const params = [];
    if (req.body.shares !== undefined) { fields.push('shares = ?'); params.push(req.body.shares); }
    if (req.body.account !== undefined) { fields.push('account = ?'); params.push(req.body.account.trim()); }
    if (req.body.bookCost !== undefined) {
      fields.push('book_cost_cents = ?');
      params.push(typeof req.body.bookCost === 'number' ? toCents(req.body.bookCost) : null);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    await run(`UPDATE holdings SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, [...params, holding.id]);
    res.json({ ok: true });
  })
);

// POST /api/investments/import  { profileId, csv: "<raw csv text>" }
// A Wealthsimple Holdings report. Each account in the file replaces that
// account's previous rows; other accounts and hand-entered holdings stay.
router.post(
  '/import',
  express.json({ limit: '2mb' }),
  validateBody({ csv: (v) => typeof v === 'string' && v.length > 0 && v.length < 2_000_000 }),
  asyncHandler(async (req, res) => {
    const profileId = await requireMember(req, res, req.body.profileId);
    if (profileId === null) return;
    let parsed;
    try {
      parsed = parseWealthsimpleHoldings(req.body.csv);
    } catch (err) {
      if (err instanceof HoldingsImportError) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.json(await applyHoldings({ profileId, userId: req.userId, source: 'wealthsimple_csv', parsed }));
  })
);

// Running two syncs of one profile at once, or one a few seconds after the
// last, gains nothing and eats into SnapTrade's per-account rate limit.
const SYNC_COOLDOWN_MS = 60 * 1000;
const syncing = new Set();

// POST /api/investments/snaptrade/sync  { profileId }
// Pulls every connected brokerage account's positions from SnapTrade into
// this profile (only for the login named in SNAPTRADE_OWNER_EMAIL).
router.post('/snaptrade/sync', asyncHandler(async (req, res) => {
  const profileId = await requireMember(req, res, req.body.profileId);
  if (profileId === null) return;
  const user = await queryOne(`SELECT email FROM users WHERE id = ?`, [req.userId]);
  const can = snaptrade.availability(user?.email);
  if (!can.available) {
    return res.status(403).json({ error: "SnapTrade sync isn't set up for your login.", reason: can.reason });
  }
  const last = await queryOne(
    `SELECT synced_at FROM holding_syncs WHERE profile_id = ? AND source = 'snaptrade'`,
    [profileId]
  );
  if (syncing.has(profileId) || (last && Date.now() - new Date(last.synced_at).getTime() < SYNC_COOLDOWN_MS)) {
    return res.status(429).json({ error: 'Synced a moment ago. Try again in a minute.' });
  }
  syncing.add(profileId);
  try {
    res.json(await syncSnapTrade({ profileId, userId: req.userId }));
  } catch (err) {
    if (err instanceof snaptrade.SnapTradeError) {
      return res.status(502).json({ error: err.message });
    }
    throw err;
  } finally {
    syncing.delete(profileId);
  }
}));

// DELETE /api/investments/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const holding = await requireHolding(req, res, req.params.id);
  if (!holding) return;
  await run(`DELETE FROM holdings WHERE id = ?`, [holding.id]);
  res.status(204).end();
}));

module.exports = router;
