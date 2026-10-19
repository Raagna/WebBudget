// Holdings from Wealthsimple: the Holdings report CSV import and the
// SnapTrade sync, against a fake Yahoo Finance and a fake SnapTrade that
// checks every request's signature.
const http = require('http');
const crypto = require('crypto');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');

// Required in before(), AFTER start(): these load ../db, which must not
// connect until start() has pointed DATABASE_URL at this file's schema.
let yahooSymbol;
let parseAsOf;
let canonical;

let env;
let api;
let yahoo;
let snap;

const MARKET = {
  'XEQT.TO': { currency: 'CAD', regularMarketPrice: 40, chartPreviousClose: 39.5, longName: 'iShares Core Equity ETF' },
  'RCI-B.TO': { currency: 'CAD', regularMarketPrice: 50, chartPreviousClose: 50 },
  AAPL: { currency: 'USD', regularMarketPrice: 300, chartPreviousClose: 298 },
  'BTC-CAD': { currency: 'CAD', regularMarketPrice: 100000, chartPreviousClose: 99000 },
  'VFV.TO': { currency: 'CAD', regularMarketPrice: 150, chartPreviousClose: 149 },
  'USDCAD=X': { currency: 'CAD', regularMarketPrice: 1.4, chartPreviousClose: 1.4 },
};

const CLIENT_ID = 'TEST-CLIENT';
const CONSUMER_KEY = 'test-consumer-key';
// What the fake SnapTrade returns; edit per test.
let SNAP = {};
let snapRequests = [];

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

before(async () => {
  yahoo = await listen((req, res) => {
    const symbol = decodeURIComponent(req.url.split('/chart/')[1].split('?')[0]);
    res.setHeader('Content-Type', 'application/json');
    const meta = MARKET[symbol];
    if (!meta) { res.statusCode = 404; res.end('{"chart":{"result":null}}'); return; }
    res.end(JSON.stringify({ chart: { result: [{ meta: { symbol, ...meta } }], error: null } }));
  });
  snap = await listen((req, res) => {
    const [path, query] = req.url.split('?');
    snapRequests.push(path);
    res.setHeader('Content-Type', 'application/json');
    const expected = crypto.createHmac('sha256', CONSUMER_KEY)
      .update(canonical({ content: null, path, query }), 'utf8').digest('base64');
    const params = new URLSearchParams(query);
    if (params.get('clientId') !== CLIENT_ID || req.headers.signature !== expected || params.has('userSecret')) {
      res.statusCode = 401;
      res.end('{"detail":"bad signature"}');
      return;
    }
    const body = SNAP[path];
    if (body === undefined) { res.statusCode = 404; res.end('{"detail":"not found"}'); return; }
    res.end(JSON.stringify(body));
  });
  process.env.QUOTES_URL = yahoo.url;
  env = await start('wealthsimple_sync');
  api = client(env.origin);
  ({ yahooSymbol, parseAsOf } = require('../utils/holdingsImport'));
  ({ canonical } = require('../utils/snaptrade'));
});
after(async () => {
  await env.stop();
  await yahoo.close();
  await snap.close();
});
beforeEach(() => {
  snapRequests = [];
  delete process.env.SNAPTRADE_CLIENT_ID;
  delete process.env.SNAPTRADE_CONSUMER_KEY;
  delete process.env.SNAPTRADE_OWNER_EMAIL;
  process.env.SNAPTRADE_URL = snap.url;
});

function useSnapTrade(owner) {
  process.env.SNAPTRADE_CLIENT_ID = CLIENT_ID;
  process.env.SNAPTRADE_CONSUMER_KEY = CONSUMER_KEY;
  process.env.SNAPTRADE_OWNER_EMAIL = owner.email.toUpperCase(); // case doesn't matter
}

async function cadUser(name) {
  const u = await newUser(api, name);
  const p = await api('POST', '/profiles', { token: u.token, body: { name: 'Investing', currency: 'CAD' } });
  assert.equal(p.status, 201, p.text);
  return { ...u, profileId: p.body.profile?.id ?? p.body.id };
}

const portfolio = (u) => api('GET', `/investments?profileId=${u.profileId}`, { token: u.token });
const importCsv = (u, csv) => api('POST', '/investments/import', { token: u.token, body: { profileId: u.profileId, csv } });
const sync = (u) => api('POST', '/investments/snaptrade/sync', { token: u.token, body: { profileId: u.profileId } });

const HEADER = 'Account Name,Account Type,Account Classification,Account Number,Symbol,Exchange,MIC,Name,Security Type,Quantity,Position Direction,Market Price,Market Price Currency,Book Value (CAD),Book Value Currency (CAD),Book Value (Market),Book Value Currency (Market),Market Value,Market Value Currency,Market Unrealized Returns,Market Unrealized Returns Currency';
const row = (acct, type, number, symbol, exchange, mic, name, kind, qty, bookCad, cur = 'CAD') =>
  `${acct},${type},Self-Directed,${number},${symbol},${exchange},${mic},${name},${kind},${qty},LONG,1,${cur},${bookCad},CAD,${bookCad},${cur},1,${cur},0,${cur}`;

const REPORT = [
  HEADER,
  row('TFSA', 'TFSA', 'HQ1111TFSA', 'XEQT', 'TSX', 'XTSE', 'iShares Core Equity ETF', 'EXCHANGE_TRADED_FUND', '10.5', '400'),
  row('TFSA', 'TFSA', 'HQ1111TFSA', 'RCI.B', 'TSX', 'XTSE', 'Rogers Communications', 'EQUITY', '3', '150'),
  row('RRSP', 'RRSP', 'HQ2222RRSP', 'AAPL', 'NASDAQ', 'XNAS', 'Apple Inc.', 'EQUITY', '2', '"1,120.00"', 'USD'),
  row('RRSP', 'RRSP', 'HQ2222RRSP', 'AAPL261218C00300000', '', '', 'AAPL Call', 'OPTION', '1', '50', 'USD'),
  row('Crypto', 'Crypto', 'WK3333CRYP', 'BTC', '', '', 'Bitcoin', 'CRYPTOCURRENCY', '0.01', '900'),
  '',
  '"As of 2026-10-17 16:05 GMT-04:00"',
].join('\n');

test('symbols are turned into Yahoo symbols', () => {
  assert.equal(yahooSymbol({ symbol: 'XEQT', mic: 'XTSE' }).symbol, 'XEQT.TO');
  assert.equal(yahooSymbol({ symbol: 'RCI.B', exchange: 'TSX' }).symbol, 'RCI-B.TO');
  assert.equal(yahooSymbol({ symbol: 'BRK.B', mic: 'XNYS' }).symbol, 'BRK-B');
  assert.equal(yahooSymbol({ symbol: 'ABC', mic: 'XTSX' }).symbol, 'ABC.V');
  assert.equal(yahooSymbol({ symbol: 'ZZZ', exchange: 'NEO' }).symbol, 'ZZZ.NE');
  assert.equal(yahooSymbol({ symbol: 'ETH', kind: 'CRYPTOCURRENCY' }).symbol, 'ETH-CAD');
  assert.equal(yahooSymbol({ symbol: 'VFV.TO' }).symbol, 'VFV.TO'); // already Yahoo form
  assert.match(yahooSymbol({ symbol: 'AAPL261218C00300000', kind: 'OPTION' }).reason, /option/);
  assert.match(yahooSymbol({ symbol: 'GOLD', exchange: '' }).reason, /no exchange/);
  assert.equal(parseAsOf('As of 2026-10-17 16:05 GMT-04:00').toISOString(), '2026-10-17T20:05:00.000Z');
});

test('a Wealthsimple holdings report imports each account, in Yahoo symbols, with CAD book costs', async () => {
  const u = await cadUser('Importer');
  const res = await importCsv(u, REPORT);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 4);
  assert.deepEqual(res.body.accounts.map((a) => a.label).sort(), ['Wealthsimple Crypto', 'Wealthsimple RRSP', 'Wealthsimple TFSA']);
  assert.equal(res.body.skipped.length, 1);
  assert.match(res.body.skipped[0].reason, /option/);
  assert.equal(new Date(res.body.asOf).toISOString(), '2026-10-17T20:05:00.000Z');
  assert.deepEqual(res.body.unpriced, []);

  const p = await portfolio(u);
  const bySym = new Map(p.body.holdings.map((h) => [h.symbol, h]));
  assert.deepEqual([...bySym.keys()].sort(), ['AAPL', 'BTC-CAD', 'RCI-B.TO', 'XEQT.TO']);
  assert.equal(bySym.get('XEQT.TO').account, 'Wealthsimple TFSA');
  assert.equal(bySym.get('XEQT.TO').source, 'wealthsimple_csv');
  assert.equal(bySym.get('XEQT.TO').bookCost, 400);
  assert.equal(bySym.get('AAPL').bookCost, 1120); // already CAD in the file: not converted again
  assert.equal(bySym.get('AAPL').value, 840); // 2 x 300 USD x 1.4
  assert.equal(bySym.get('BTC-CAD').shares, 0.01);
  assert.ok(p.body.sources.wealthsimpleCsv.syncedAt);
  assert.equal(p.body.sources.snaptrade.available, false);
  assert.equal(p.body.sources.snaptrade.reason, 'not_configured');
});

test('importing again replaces those accounts only, and never touches hand-entered holdings', async () => {
  const u = await cadUser('Reimporter');
  assert.equal((await importCsv(u, REPORT)).status, 200);
  const manual = await api('POST', '/investments', { token: u.token, body: { profileId: u.profileId, symbol: 'VFV.TO', shares: 4, account: 'Questrade' } });
  assert.equal(manual.status, 201, manual.text);

  // A TFSA-only report a month later: RCI.B was sold, XEQT grew.
  const later = [HEADER, row('TFSA', 'TFSA', 'HQ1111TFSA', 'XEQT', 'TSX', 'XTSE', 'iShares Core Equity ETF', 'EXCHANGE_TRADED_FUND', '12', '480'), '"As of 2026-11-17 16:05 GMT-05:00"'].join('\n');
  const res = await importCsv(u, later);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 1);
  assert.equal(res.body.removed, 2);

  const p = await portfolio(u);
  const got = p.body.holdings.map((h) => `${h.symbol}:${h.shares}:${h.account}`).sort();
  assert.deepEqual(got, [
    'AAPL:2:Wealthsimple RRSP', // other accounts kept
    'BTC-CAD:0.01:Wealthsimple Crypto',
    'VFV.TO:4:Questrade', // manual kept
    'XEQT.TO:12:Wealthsimple TFSA',
  ]);
});

test('two accounts whose numbers end in the same four characters both import', async () => {
  const u = await cadUser('SameLast4');
  const csv = [
    HEADER,
    row('TFSA', 'TFSA', 'HQ1234567CAD', 'XEQT', 'TSX', 'XTSE', 'iShares Core Equity ETF', 'EXCHANGE_TRADED_FUND', '5', '200'),
    row('RRSP', 'RRSP', 'HQ7654327CAD', 'VFV', 'TSX', 'XTSE', 'Vanguard S&P 500', 'EXCHANGE_TRADED_FUND', '2', '300'),
  ].join('\n');
  const res = await importCsv(u, csv);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 2);
  assert.equal(res.body.removed, 0);
  const got = (await portfolio(u)).body.holdings.map((h) => `${h.symbol}:${h.account}`).sort();
  assert.deepEqual(got, ['VFV.TO:Wealthsimple RRSP', 'XEQT.TO:Wealthsimple TFSA']);
});

test('the wrong file is refused with a hint, and imported holdings are edited at Wealthsimple', async () => {
  const u = await cadUser('WrongFile');
  const activities = 'transaction_date,settlement_date,account_id,account_type,activity_type,activity_sub_type,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount\n2026-10-01,2026-10-02,HQ1,TFSA,Trade,BUY,LONG,XEQT,iShares,CAD,1,40,0,-40';
  const a = await importCsv(u, activities);
  assert.equal(a.status, 400);
  assert.match(a.body.error, /activities export/);
  const b = await importCsv(u, 'date,description,amount\n2026-10-01,Coffee,4');
  assert.equal(b.status, 400);
  assert.match(b.body.error, /Holdings report/);

  assert.equal((await importCsv(u, REPORT)).status, 200);
  const h = (await portfolio(u)).body.holdings[0];
  const put = await api('PUT', `/investments/${h.id}`, { token: u.token, body: { shares: 99 } });
  assert.equal(put.status, 409);
  assert.equal((await api('DELETE', `/investments/${h.id}`, { token: u.token })).status, 204);
});

function snapAccounts() {
  SNAP = {
    '/api/v1/authorizations': [
      { id: 'conn-ws', brokerage: { name: 'Wealthsimple', slug: 'WEALTHSIMPLETRADE', display_name: 'Wealthsimple' }, disabled: false },
    ],
    '/api/v1/accounts/all': {
      results: [
        { kind: 'investment', id: 'acc-tfsa', connection_id: 'conn-ws', display_name: 'TFSA', masked_account_number: '****TFSA', raw_type: 'TFSA', is_paper: false, sync_status: {} },
        { kind: 'investment', id: 'acc-rrsp', connection_id: 'conn-ws', display_name: 'RRSP', masked_account_number: '****RRSP', raw_type: 'RRSP', is_paper: false, sync_status: {} },
        { kind: 'deposit', id: 'acc-cash', connection_id: 'conn-ws', display_name: 'Chequing', masked_account_number: '****CASH', sync_status: {} },
      ],
    },
    '/api/v1/accounts/acc-tfsa/positions/all': {
      results: [
        { instrument: { kind: 'etf', id: 'i1', symbol: 'XEQT.TO', raw_symbol: 'XEQT', description: 'iShares Core Equity ETF', currency: 'CAD', exchange: 'XTSE' }, units: '15', price: '40', cost_basis: '38', currency: 'CAD' },
        { instrument: { kind: 'option', id: 'i2', symbol: 'XEQT 261218C', raw_symbol: 'XEQT' }, units: '1', cost_basis: '1', currency: 'CAD' },
      ],
      data_freshness: { as_of: '2026-10-18T14:00:00Z' },
    },
    '/api/v1/accounts/acc-rrsp/positions/all': {
      results: [
        { instrument: { kind: 'stock', id: 'i3', symbol: 'AAPL', raw_symbol: 'AAPL', description: 'Apple Inc.', currency: 'USD', exchange: 'XNAS' }, units: '3', price: '300', cost_basis: '200', currency: 'USD' },
      ],
      data_freshness: { as_of: '2026-10-18T13:00:00Z' },
    },
  };
}

test('SnapTrade sync pulls each investment account, converts USD costs, and replaces the same accounts from a CSV import', async () => {
  const u = await cadUser('Syncer');
  useSnapTrade(u);
  snapAccounts();
  assert.equal((await importCsv(u, REPORT)).status, 200); // TFSA HQ1111TFSA, RRSP HQ2222RRSP, Crypto

  const before = await portfolio(u);
  assert.equal(before.body.sources.snaptrade.available, true);

  const res = await sync(u);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 2);
  assert.equal(res.body.skipped.length, 1); // the option
  assert.equal(new Date(res.body.asOf).toISOString(), '2026-10-18T13:00:00.000Z'); // the older of the two
  assert.ok(!snapRequests.includes('/api/v1/accounts/acc-cash/positions/all'), 'deposit accounts are not asked for positions');

  const p = await portfolio(u);
  const got = p.body.holdings.map((h) => `${h.symbol}:${h.shares}:${h.account}:${h.source}:${h.bookCost}`).sort();
  assert.deepEqual(got, [
    'AAPL:3:Wealthsimple RRSP:snaptrade:840', // 3 x 200 USD x 1.4; the CSV's RRSP rows were replaced
    'BTC-CAD:0.01:Wealthsimple Crypto:wealthsimple_csv:900', // not on SnapTrade: kept from the CSV
    'XEQT.TO:15:Wealthsimple TFSA:snaptrade:570', // 15 x 38; CSV TFSA rows (XEQT, RCI.B) replaced
  ]);
  assert.ok(p.body.sources.snaptrade.last.syncedAt);

  // Straight away again: refused, so a double click can't burn rate limit.
  assert.equal((await sync(u)).status, 429);
});

test('SnapTrade sync is only for the key owner, and a bad key is reported plainly', async () => {
  const owner = await cadUser('Owner');
  const other = await cadUser('Other');
  useSnapTrade(owner);
  snapAccounts();

  const o = await portfolio(other);
  assert.equal(o.body.sources.snaptrade.available, false);
  assert.equal(o.body.sources.snaptrade.reason, 'not_owner');
  assert.equal((await sync(other)).status, 403);
  assert.equal(snapRequests.length, 0);

  process.env.SNAPTRADE_CONSUMER_KEY = 'wrong-key';
  const bad = await sync(owner);
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /refused the API key/);
});
