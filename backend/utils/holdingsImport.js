// Holdings that come from Wealthsimple rather than the form: the
// "Holdings report" CSV it lets you download, and (in snaptrade.js) a
// SnapTrade sync. Both end up as the same shape - a list of accounts, each
// with its positions - which replaceAccounts() writes to the holdings
// table.
//
// Wealthsimple web app > Documents > Holdings report (CSV) writes one header
// row and one row per position, then a one-cell trailer line:
//
//   Account Name,Account Type,Account Classification,Account Number,Symbol,
//   Exchange,MIC,Name,Security Type,Quantity,Position Direction,Market Price,
//   Market Price Currency,Book Value (CAD),Book Value Currency (CAD),
//   Book Value (Market),Book Value Currency (Market),Market Value,
//   Market Value Currency,Market Unrealized Returns,
//   Market Unrealized Returns Currency
//   TFSA,TFSA,Self-Directed,HQ1234567CAD,XEQT,TSX,XTSE,iShares Core...,EXCHANGE_TRADED_FUND,10.5,LONG,...
//   "As of 2026-10-17 16:05 GMT-04:00"
//
// Wealthsimple doesn't document the file. The layout above is the one
// open-source importers agree on, so columns are found by header name (in
// any order, any case) and anything else in the file is ignored.
//
// Two things the file does differently from what this app stores:
// - Symbol has no exchange suffix ("XEQT", not "XEQT.TO"); the MIC (or
//   Exchange) column says where it's listed, and yahooSymbol() adds it.
// - Book Value (CAD) is in Canadian dollars even for US stocks, so it only
//   needs converting when the profile isn't in CAD.

const { parseCsv } = require('./csv');
const { parseMoney } = require('./bankImport');
const { normalizeSymbol } = require('./quotes');

class HoldingsImportError extends Error {}

// Yahoo Finance suffix for each listing venue, by MIC code and by the
// exchange names brokers print. '' means a US listing (no suffix).
const SUFFIX_BY_MIC = {
  XTSE: '.TO', XTSX: '.V', NEOE: '.NE', XNEO: '.NE', XCNQ: '.CN', CSE2: '.CN',
  XNAS: '', XNYS: '', ARCX: '', XASE: '', BATS: '', XCBO: '', IEXG: '', OTCM: '', OOTC: '',
  XLON: '.L', XASX: '.AX',
};
const SUFFIX_BY_EXCHANGE = {
  TSX: '.TO', TSE: '.TO', TSXV: '.V', 'TSX-V': '.V', 'TSX VENTURE': '.V', NEO: '.NE', 'CBOE CANADA': '.NE', 'CBOE CA': '.NE',
  CSE: '.CN', CNSX: '.CN',
  NYSE: '', NASDAQ: '', 'NYSE ARCA': '', NYSEARCA: '', ARCA: '', 'NYSE AMERICAN': '', AMEX: '', BATS: '', 'CBOE BZX': '', OTC: '',
};

const KNOWN_SUFFIX = /\.(TO|V|NE|CN|L|AX)$/;

// Turns a broker's symbol + listing into Yahoo's: "XEQT" on XTSE ->
// "XEQT.TO", "RCI.B" on TSX -> "RCI-B.TO", "BRK.B" on NYSE -> "BRK-B",
// crypto "BTC" -> "BTC-CAD". Returns { symbol } or { reason } when it can't
// be priced from Yahoo (options, precious metals, unknown venues).
function yahooSymbol({ symbol, exchange, mic, kind, currency }) {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return { reason: 'No symbol' };
  const type = String(kind || '').toUpperCase();
  if (/OPTION/.test(type)) return { reason: `${raw} is an option, which can't be priced here yet` };
  if (/CRYPTO/.test(type)) {
    const coin = raw.replace(/-.*$/, '');
    return { symbol: normalizeSymbol(`${coin}-${(currency || 'CAD').toUpperCase()}`) || undefined, reason: `Unrecognised coin ${raw}` };
  }

  let suffix = SUFFIX_BY_MIC[String(mic || '').trim().toUpperCase()];
  if (suffix === undefined) suffix = SUFFIX_BY_EXCHANGE[String(exchange || '').trim().toUpperCase()];
  if (suffix === undefined) {
    // Already in Yahoo form (SnapTrade's formatted symbol often is).
    if (KNOWN_SUFFIX.test(raw)) return { symbol: normalizeSymbol(raw) || undefined, reason: `Unrecognised symbol ${raw}` };
    if (/FUND/.test(type) && !/EXCHANGE_TRADED/.test(type)) {
      return { reason: `${raw} is a mutual fund, which Yahoo Finance usually can't price; add it by hand if it has a Yahoo symbol` };
    }
    const where = exchange || mic;
    return { reason: where ? `${raw} is listed on ${where}, which this app can't price yet` : `${raw} has no exchange (precious metals and some funds can't be priced here)` };
  }
  // Share classes: Yahoo writes RCI-B.TO and BRK-B where brokers write
  // RCI.B, RCI/B or "BRK B".
  const ticker = raw.replace(/\.(TO|V|NE|CN|L|AX)$/, '').replace(/[./ ]+/g, '-');
  const out = normalizeSymbol(ticker + suffix);
  return out ? { symbol: out } : { reason: `Unrecognised symbol ${raw}` };
}

const lastFour = (number) => {
  const s = String(number || '').replace(/[^A-Za-z0-9]/g, '');
  return s.length >= 4 ? s.slice(-4).toUpperCase() : null;
};

// "As of 2026-10-17 16:05 GMT-04:00" -> Date. Missing pieces are fine.
function parseAsOf(cell) {
  const m = String(cell || '').match(/As of\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?(?:\s*(?:GMT|UTC)?\s*([+-])(\d{1,2}):?(\d{2})?)?/i);
  if (!m) return null;
  const [, date, hh = '00', mm = '00', sign, oh, om = '00'] = m;
  const offset = sign ? `${sign}${oh.padStart(2, '0')}:${om}` : 'Z';
  const d = new Date(`${date}T${hh.padStart(2, '0')}:${mm}:00${offset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Parses a Holdings report into
//   { asOf, accounts: [{ externalAccount, wsLast4, label, positions: [{ symbol, name, shares, bookCost, bookCostCurrency }] }], skipped: [{ row, reason }] }
// Throws HoldingsImportError for a file that isn't a holdings report.
function parseWealthsimpleHoldings(text) {
  const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
  const top = rows.slice(0, 10).map((r) => r.map((c) => c.trim().toLowerCase()));
  // The activities export also has symbol and quantity columns, so it's
  // told apart first.
  if (top.some((cells) => cells.includes('transaction_date') || cells.includes('activity_type'))) {
    throw new HoldingsImportError("That's Wealthsimple's activities export. Download the Holdings report (CSV) instead: Documents > Holdings report.");
  }
  const headerAt = top.findIndex((cells) => cells.includes('symbol') && cells.includes('quantity'));
  if (headerAt === -1) {
    throw new HoldingsImportError("This doesn't look like a Wealthsimple holdings report. In Wealthsimple, go to Documents, choose Holdings report (CSV), and upload that file. (Set Wealthsimple to English first if the columns are in French.)");
  }
  const header = rows[headerAt].map((c) => c.trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const at = (row, name) => { const i = col(name); return i === -1 ? '' : String(row[i] ?? '').trim(); };

  let asOf = null;
  const skipped = [];
  const byAccount = new Map();
  rows.slice(headerAt + 1).forEach((row, i) => {
    const rowNum = headerAt + i + 2; // 1-based, counting the header
    const filled = row.filter((c) => c.trim() !== '');
    if (filled.length === 0) return;
    if (filled.length === 1) { asOf = parseAsOf(filled[0]) || asOf; return; }

    const symbolCell = at(row, 'symbol');
    const name = at(row, 'name');
    if (at(row, 'position direction') && at(row, 'position direction').toUpperCase() !== 'LONG') {
      skipped.push({ row: rowNum, reason: `${symbolCell || name}: short positions aren't supported` });
      return;
    }
    const shares = parseMoney(at(row, 'quantity'));
    if (!(shares > 0) || shares > 1e9) {
      skipped.push({ row: rowNum, reason: `${symbolCell || name}: quantity "${at(row, 'quantity')}" isn't a number of shares` });
      return;
    }
    const mapped = yahooSymbol({
      symbol: symbolCell,
      exchange: at(row, 'exchange'),
      mic: at(row, 'mic'),
      kind: at(row, 'security type'),
      currency: at(row, 'market price currency') || 'CAD',
    });
    if (!mapped.symbol) { skipped.push({ row: rowNum, reason: mapped.reason }); return; }

    // Prefer the CAD book value (one currency for the whole file); fall back
    // to the listing-currency one.
    let bookCost = parseMoney(at(row, 'book value (cad)'));
    let bookCostCurrency = (at(row, 'book value currency (cad)') || 'CAD').toUpperCase();
    if (!(bookCost >= 0)) {
      bookCost = parseMoney(at(row, 'book value (market)'));
      bookCostCurrency = (at(row, 'book value currency (market)') || at(row, 'market price currency') || 'CAD').toUpperCase();
    }
    if (!(bookCost >= 0)) bookCost = null;

    const number = at(row, 'account number');
    const accountName = at(row, 'account name') || at(row, 'account type') || 'Account';
    const key = number || accountName;
    if (!byAccount.has(key)) {
      const managed = /managed/i.test(at(row, 'account classification'));
      byAccount.set(key, {
        externalAccount: key,
        wsLast4: lastFour(number),
        label: `Wealthsimple ${accountName}${managed ? ' (managed)' : ''}`,
        positions: new Map(),
      });
    }
    const positions = byAccount.get(key).positions;
    const prev = positions.get(mapped.symbol);
    if (prev) {
      // Same security twice in one account (e.g. split lots): add them up.
      prev.shares += shares;
      prev.bookCost = prev.bookCost === null || bookCost === null ? null : prev.bookCost + bookCost;
    } else {
      positions.set(mapped.symbol, { symbol: mapped.symbol, name, shares, bookCost, bookCostCurrency });
    }
  });

  const accounts = disambiguateLabels([...byAccount.values()].map((a) => ({ ...a, positions: [...a.positions.values()] })));
  if (accounts.length === 0 && skipped.length === 0) {
    throw new HoldingsImportError('This holdings report has no positions in it.');
  }
  return { asOf, accounts, skipped };
}

// Two accounts both called "Wealthsimple TFSA" (yours and a spouse's in one
// login) get their last four characters added so they stay tell-apart.
function disambiguateLabels(accounts) {
  const counts = new Map();
  for (const a of accounts) counts.set(a.label, (counts.get(a.label) || 0) + 1);
  return accounts.map((a) => ({
    ...a,
    label: (counts.get(a.label) > 1 && a.wsLast4 ? `${a.label} ···${a.wsLast4}` : a.label).slice(0, 80),
  }));
}

// Writes accounts (the shape parseWealthsimpleHoldings returns) for one
// source, inside the caller's transaction. Each account's previous rows are
// replaced, from this source and - for a Wealthsimple account - from the
// other Wealthsimple source too, so CSV and SnapTrade never double count.
// Accounts not in `accounts` are left alone. bookCosts must already be in
// the profile's currency (bookCostCents). Returns { inserted, removed }.
async function replaceAccounts(tx, { profileId, source, accounts, userId }) {
  let inserted = 0;
  let removed = 0;
  for (const a of accounts) {
    const del = await tx.run(
      `DELETE FROM holdings
        WHERE profile_id = ? AND source <> 'manual'
          AND ((source = ? AND external_account = ?) OR (?::text IS NOT NULL AND ws_account_last4 = ?))`,
      [profileId, source, a.externalAccount, a.wsLast4 || null, a.wsLast4 || null]
    );
    removed += del.rowCount;
    for (const p of a.positions) {
      await tx.run(
        `INSERT INTO holdings (profile_id, symbol, account, shares, book_cost_cents, created_by, source, external_account, ws_account_last4)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [profileId, p.symbol, a.label, Number(p.shares.toFixed(8)), p.bookCostCents ?? null, userId, source, a.externalAccount, a.wsLast4 || null]
      );
      inserted++;
    }
  }
  return { inserted, removed };
}

// Book costs into the profile's currency, given rates from quotes.getRates.
// A cost in a currency that can't be converted is dropped (value still
// shows, gain doesn't) rather than stored in the wrong currency.
function withCostsIn(accounts, rates) {
  return accounts.map((a) => ({
    ...a,
    positions: a.positions.map((p) => {
      const rate = p.bookCost === null ? undefined : rates.get(p.bookCostCurrency);
      return { ...p, bookCostCents: rate === undefined ? null : Math.round(p.bookCost * rate * 100) };
    }),
  }));
}

module.exports = {
  HoldingsImportError,
  yahooSymbol,
  parseAsOf,
  parseWealthsimpleHoldings,
  replaceAccounts,
  withCostsIn,
  lastFour,
};
