// Stock, ETF, crypto and currency prices for the Investments page.
//
// Source: Yahoo Finance's chart endpoint. It needs no API key, but it is
// NOT an official, documented API - Yahoo can change or block it without
// notice. So everything goes through this one file: prices are cached in
// the quotes table (one fetch serves every profile until it goes stale),
// a failed fetch falls back to the last known price marked stale, and
// swapping in a keyed provider later means changing fetchQuote() only.
//
// Settings, read on every call so tests can point them at a fake server:
//   QUOTES_URL      base URL (default https://query1.finance.yahoo.com)
//   QUOTE_TTL_MS    how long a price counts as fresh (default 15 min)

const { query, run } = require('../db');

const TIMEOUT_MS = 8000;

function settings() {
  return {
    base: (process.env.QUOTES_URL || 'https://query1.finance.yahoo.com').replace(/\/+$/, ''),
    ttlMs: Number(process.env.QUOTE_TTL_MS) || 15 * 60 * 1000,
  };
}

// Yahoo symbols: letters, digits and . - = ^ ("XEQT.TO", "BRK-B",
// "USDCAD=X", "^GSPTSE"). Upper-cased so "xeqt.to" and "XEQT.TO" share a
// cache row.
function normalizeSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9.\-=^]{1,20}$/.test(s) ? s : null;
}

class QuoteNotFound extends Error {}

// One live price from Yahoo. Returns { symbol, name, currency, price,
// previousClose }, throws QuoteNotFound for a symbol Yahoo doesn't know,
// and any other error when Yahoo can't be reached.
async function fetchQuote(symbol) {
  const { base } = settings();
  const res = await fetch(`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (WebBudget price check)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) throw new QuoteNotFound(symbol);
  if (!res.ok) throw new Error(`quote source returned ${res.status}`);
  const body = await res.json();
  const meta = body?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!meta || !Number.isFinite(price)) throw new QuoteNotFound(symbol);

  let currency = String(meta.currency || '').trim();
  let previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  let scale = 1;
  // London prices are quoted in pence ("GBp"); keep everything in whole
  // currency units so the conversion below stays simple.
  if (currency === 'GBp') { currency = 'GBP'; scale = 0.01; }
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: currency.toUpperCase() || 'USD',
    price: price * scale,
    previousClose: Number.isFinite(previousClose) ? previousClose * scale : null,
    // When the market set this price - Friday's close, all weekend.
    marketTime: Number.isFinite(Number(meta.regularMarketTime)) ? new Date(Number(meta.regularMarketTime) * 1000) : null,
  };
}

function rowToQuote(row, stale) {
  return {
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    price: Number(row.price),
    previousClose: row.previous_close === null ? null : Number(row.previous_close),
    asOf: row.market_time || row.fetched_at,
    stale,
  };
}

async function saveQuote(q) {
  await run(
    `INSERT INTO quotes (symbol, name, currency, price, previous_close, market_time, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (symbol) DO UPDATE
       SET name = EXCLUDED.name, currency = EXCLUDED.currency, price = EXCLUDED.price,
           previous_close = EXCLUDED.previous_close, market_time = EXCLUDED.market_time, fetched_at = NOW()`,
    [q.symbol, q.name, q.currency, q.price, q.previousClose, q.marketTime]
  );
}

// Map symbol -> quote for every symbol it can price. Fresh cache rows are
// used as they are; stale or missing ones are fetched (in parallel). If a
// fetch fails, the old row is returned with stale: true; a symbol never
// priced before and unreachable now is simply missing from the map.
async function getQuotes(symbols) {
  const wanted = [...new Set(symbols)];
  const out = new Map();
  if (wanted.length === 0) return out;
  const { ttlMs } = settings();

  const cached = await query(`SELECT * FROM quotes WHERE symbol = ANY(?)`, [wanted]);
  const bySymbol = new Map(cached.map((r) => [r.symbol, r]));
  const now = Date.now();
  const toFetch = [];
  for (const s of wanted) {
    const row = bySymbol.get(s);
    if (row && now - new Date(row.fetched_at).getTime() < ttlMs) out.set(s, rowToQuote(row, false));
    else toFetch.push(s);
  }

  await Promise.all(toFetch.map(async (s) => {
    try {
      const q = await fetchQuote(s);
      await saveQuote(q);
      out.set(s, { ...q, asOf: q.marketTime || new Date(), stale: false });
    } catch (err) {
      if (!(err instanceof QuoteNotFound)) console.error(`[quotes] ${s}:`, err.message);
      const row = bySymbol.get(s);
      if (row) out.set(s, rowToQuote(row, true));
    }
  }));
  return out;
}

// Rates to convert each currency into `target`, as Map currency -> rate.
// Uses Yahoo's currency pairs ("USDCAD=X"), cached like any other quote.
// A currency it can't convert is missing from the map.
async function getRates(currencies, target) {
  const rates = new Map([[target, 1]]);
  const others = [...new Set(currencies)].filter((c) => c && c !== target);
  const pairs = await getQuotes(others.map((c) => `${c}${target}=X`));
  for (const c of others) {
    const q = pairs.get(`${c}${target}=X`);
    if (q && q.price > 0) rates.set(c, q.price);
  }
  return rates;
}

module.exports = { normalizeSymbol, fetchQuote, getQuotes, getRates, saveQuote, QuoteNotFound };
