// SnapTrade sync: reads the positions in brokerage accounts (Wealthsimple
// included) connected to a SnapTrade *Personal* key.
//
// Wealthsimple has no public API. SnapTrade connects to it on your behalf -
// you log in to Wealthsimple once in SnapTrade's own Connection Portal, and
// from then on this app only ever holds SnapTrade's API key, never your
// Wealthsimple password. A Personal key is free, but it is for ONE person's
// own accounts: whoever's key it is, only they may sync with it. So the
// sync is switched on for a single WebBudget login (SNAPTRADE_OWNER_EMAIL);
// everyone else sees it as unavailable.
//
// Settings (backend/.env, or the host's environment - never the browser):
//   SNAPTRADE_CLIENT_ID      Personal key's client ID  (dashboard.snaptrade.com)
//   SNAPTRADE_CONSUMER_KEY   Personal key's consumer key (it signs every request)
//   SNAPTRADE_OWNER_EMAIL    the WebBudget login allowed to sync with this key
//   SNAPTRADE_URL            API base (default https://api.snaptrade.com; tests use a fake)
//
// Requests are signed as SnapTrade documents (docs.snaptrade.com/docs/request-signatures):
// HMAC-SHA256 with the consumer key over the canonical JSON of
// { content, path, query }, base64, in a Signature header, with clientId
// and timestamp in the query. Personal keys send no userId/userSecret -
// SnapTrade resolves the user from the key.
//
// Rate limits: 250 requests/minute per key and 10/minute per account. A
// sync is 2 calls plus 1 per account, and routes/investments.js won't run
// one within a minute of the last, so neither limit is close.

const crypto = require('crypto');
const { yahooSymbol, lastFour } = require('./holdingsImport');

const TIMEOUT_MS = 20000;

class SnapTradeError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

function settings() {
  return {
    base: (process.env.SNAPTRADE_URL || 'https://api.snaptrade.com').replace(/\/+$/, ''),
    clientId: (process.env.SNAPTRADE_CLIENT_ID || '').trim(),
    consumerKey: (process.env.SNAPTRADE_CONSUMER_KEY || '').trim(),
    ownerEmail: (process.env.SNAPTRADE_OWNER_EMAIL || '').trim().toLowerCase(),
  };
}

// Whether this login can sync: { available, reason }. The reason is shown
// on the Investments page, so it says what to do.
function availability(userEmail) {
  const s = settings();
  if (!s.clientId || !s.consumerKey) {
    return { available: false, reason: 'not_configured' };
  }
  if (!s.ownerEmail) return { available: false, reason: 'no_owner' };
  if (String(userEmail || '').trim().toLowerCase() !== s.ownerEmail) {
    return { available: false, reason: 'not_owner' };
  }
  return { available: true };
}

// JSON with object keys sorted at every level and no whitespace.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sign(consumerKey, { path, query, content = null }) {
  return crypto.createHmac('sha256', consumerKey).update(canonical({ content, path, query }), 'utf8').digest('base64');
}

async function signedGet(path) {
  const s = settings();
  const fullPath = `/api/v1${path}`;
  // Built once and used for both the signature and the URL: SnapTrade
  // signs the query string exactly as sent.
  const query = new URLSearchParams({ clientId: s.clientId, timestamp: String(Math.floor(Date.now() / 1000)) }).toString();
  let res;
  try {
    res = await fetch(`${s.base}${fullPath}?${query}`, {
      headers: { Accept: 'application/json', Signature: sign(s.consumerKey, { path: fullPath, query }) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new SnapTradeError(`Couldn't reach SnapTrade (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SnapTradeError('SnapTrade refused the API key. Check SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY.', { status: res.status });
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('x-ratelimit-account-reset') || res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset'));
    throw new SnapTradeError(`SnapTrade is rate limiting this key; try again in ${Number.isFinite(wait) && wait > 0 ? `${Math.ceil(wait)} seconds` : 'a minute'}.`, { status: 429 });
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* not JSON */ }
    throw new SnapTradeError(`SnapTrade returned an error (${res.status})${detail ? `: ${detail}` : ''}.`, { status: res.status });
  }
  return res.json();
}

// Kinds this app can price from Yahoo, mapped to the security-type words
// yahooSymbol() understands. Options, futures, CFDs and bonds are skipped.
const PRICEABLE = { stock: 'EQUITY', etf: 'EXCHANGE_TRADED_FUND', adr: 'EQUITY', cef: 'EQUITY', mutualfund: 'MUTUAL_FUND', crypto: 'CRYPTO' };

function toPosition(p) {
  const inst = p.instrument || {};
  const label = inst.symbol || inst.raw_symbol || inst.description || 'A position';
  const kind = PRICEABLE[inst.kind];
  if (!kind) return { reason: `${label}: ${inst.kind || 'this kind of'} position can't be priced here yet` };
  const shares = Number(p.units);
  if (!(shares > 0) || shares > 1e9) return { reason: `${label}: ${shares < 0 ? "short positions aren't supported" : 'no units'}` };

  // Build Yahoo's symbol from the raw ticker and listing venue; fall back
  // to SnapTrade's formatted symbol, which largely follows Yahoo already.
  let mapped = yahooSymbol({ symbol: inst.raw_symbol || inst.symbol, exchange: inst.exchange, mic: inst.exchange, kind, currency: p.currency || inst.currency });
  if (!mapped.symbol && inst.symbol && inst.symbol !== inst.raw_symbol) {
    const again = yahooSymbol({ symbol: inst.symbol, kind });
    if (again.symbol) mapped = again;
  }
  if (!mapped.symbol) return { reason: mapped.reason };

  // cost_basis is the average price paid per unit, in the position currency.
  const perUnit = p.cost_basis === null || p.cost_basis === undefined ? NaN : Number(p.cost_basis);
  return {
    position: {
      symbol: mapped.symbol,
      name: inst.description || mapped.symbol,
      shares,
      bookCost: Number.isFinite(perUnit) && perUnit >= 0 ? perUnit * shares : null,
      bookCostCurrency: String(p.currency || inst.currency || '').toUpperCase() || null,
    },
  };
}

function accountLabel(account, brokerage) {
  const name = (account.display_name || account.raw_type || 'account').trim();
  const brand = (brokerage || '').trim();
  const label = brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
  return label.slice(0, 80);
}

// Every investment account on the key, with its positions, in the shape
// holdingsImport.replaceAccounts() takes. Also returns `skipped` (positions
// it couldn't map) and `broken` (connections SnapTrade says need a
// reconnect - their accounts still return the last cached positions).
async function fetchAccounts() {
  const connections = await signedGet('/authorizations');
  const byConnection = new Map((Array.isArray(connections) ? connections : []).map((c) => [c.id, c]));
  const broken = [...byConnection.values()].filter((c) => c.disabled).map((c) => c.brokerage?.display_name || c.brokerage?.name || c.name || 'A brokerage');

  const all = await signedGet('/accounts/all');
  const investment = (all?.results || []).filter((a) => a.kind === 'investment' && !a.is_paper);

  const accounts = [];
  const skipped = [];
  let asOf = null;
  // One account at a time: the per-account rate limit is per account, but
  // there's no hurry and it keeps a sync to a few calls per second at most.
  for (const a of investment) {
    const conn = byConnection.get(a.connection_id);
    const brokerage = conn?.brokerage?.display_name || conn?.brokerage?.name || '';
    const isWealthsimple = /wealthsimple/i.test(`${conn?.brokerage?.slug || ''} ${brokerage}`);
    const label = accountLabel(a, brokerage);
    const body = await signedGet(`/accounts/${encodeURIComponent(a.id)}/positions/all`);
    const when = body?.data_freshness?.as_of ? new Date(body.data_freshness.as_of) : null;
    if (when && !Number.isNaN(when.getTime()) && (!asOf || when < asOf)) asOf = when;

    const positions = new Map();
    for (const p of body?.results || []) {
      const out = toPosition(p);
      if (!out.position) { skipped.push({ account: label, reason: out.reason }); continue; }
      const prev = positions.get(out.position.symbol);
      if (prev) {
        prev.shares += out.position.shares;
        prev.bookCost = prev.bookCost === null || out.position.bookCost === null ? null : prev.bookCost + out.position.bookCost;
      } else {
        positions.set(out.position.symbol, out.position);
      }
    }
    accounts.push({
      externalAccount: a.id,
      wsLast4: isWealthsimple ? lastFour(a.masked_account_number) : null,
      label,
      positions: [...positions.values()],
    });
  }
  return { asOf, accounts, skipped, broken };
}

module.exports = { availability, fetchAccounts, sign, canonical, SnapTradeError };
