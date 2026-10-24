// Accounts, balances and net worth, with investments from a fake Yahoo.
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');

let env;
let api;
let yahoo;

before(async () => {
  yahoo = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/chart/VFV.TO')) {
      return res.end(JSON.stringify({ chart: { result: [{ meta: { symbol: 'VFV.TO', currency: 'CAD', regularMarketPrice: 150, chartPreviousClose: 149, longName: 'Vanguard S&P 500' } }] } }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ chart: { result: null, error: { code: 'Not Found' } } }));
  });
  await new Promise((r) => yahoo.listen(0, '127.0.0.1', r));
  process.env.QUOTES_URL = `http://127.0.0.1:${yahoo.address().port}`;
  env = await start('networth');
  api = client(env.origin);
});
after(async () => {
  await env.stop();
  await new Promise((r) => yahoo.close(r));
});

const TODAY = '2026-10-19';
async function cadUser(name) {
  const u = await newUser(api, name);
  const p = await api('POST', '/profiles', { token: u.token, body: { name: 'Mine', currency: 'CAD' } });
  return { ...u, profileId: p.body.id };
}
const worth = (u) => api('GET', `/networth?profileId=${u.profileId}&today=${TODAY}`, { token: u.token });
const addAccount = (u, body) => api('POST', '/networth/accounts', { token: u.token, body: { profileId: u.profileId, ...body } });

test('net worth is assets minus debts, with investments at their live value', async () => {
  const u = await cadUser('Worth');
  assert.equal((await addAccount(u, { name: 'TD Chequing', kind: 'chequing', balance: 2500, asOf: '2026-08-15' })).status, 201);
  assert.equal((await addAccount(u, { name: 'TD Visa', kind: 'credit_card', balance: 800, asOf: '2026-09-10' })).status, 201);
  await api('POST', '/investments', { token: u.token, body: { profileId: u.profileId, symbol: 'VFV.TO', shares: 10 } });

  const res = await worth(u);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.totals, { assets: 4000, debts: 800, netWorth: 3200 }); // 2,500 + 1,500 investments - 800
  assert.equal(res.body.investments, 1500);
  const visa = res.body.accounts.find((a) => a.name === 'TD Visa');
  assert.deepEqual([visa.debt, visa.balance, visa.asOf], [true, 800, '2026-09-10']);

  // History starts in August, the first month with anything recorded.
  assert.deepEqual(res.body.history.map((h) => [h.month, h.netWorth]), [
    ['2026-08', 2500],
    ['2026-09', 1700],
    ['2026-10', 3200],
  ]);
  assert.equal(res.body.changeSinceLastMonth, 1500);
});

test('updating a balance moves net worth; the same day replaces, not adds', async () => {
  const u = await cadUser('Updater');
  const { body } = await addAccount(u, { name: 'Savings', kind: 'savings', balance: 1000, asOf: '2026-10-01' });
  const update = (balance, asOf) => api('POST', `/networth/accounts/${body.id}/balances`, { token: u.token, body: { balance, asOf } });
  assert.equal((await update(1200, '2026-10-15')).status, 201);
  assert.equal((await update(1300, '2026-10-15')).status, 201);
  assert.equal((await worth(u)).body.totals.netWorth, 1300);

  assert.equal((await api('PUT', `/networth/accounts/${body.id}`, { token: u.token, body: { name: 'EQ Savings' } })).status, 200);
  assert.equal((await worth(u)).body.accounts[0].name, 'EQ Savings');
  assert.equal((await api('DELETE', `/networth/accounts/${body.id}`, { token: u.token })).status, 204);
  assert.deepEqual((await worth(u)).body.totals, { assets: 0, debts: 0, netWorth: 0 });
});

test('accounts are checked and private to the profile', async () => {
  const u = await cadUser('Private');
  const other = await cadUser('Nosy');
  const { body } = await addAccount(u, { name: 'Cash', kind: 'cash', balance: 40 });
  assert.equal((await api('GET', `/networth?profileId=${u.profileId}`, { token: other.token })).status, 404);
  assert.equal((await api('POST', `/networth/accounts/${body.id}/balances`, { token: other.token, body: { balance: 1 } })).status, 404);
  assert.equal((await api('DELETE', `/networth/accounts/${body.id}`, { token: other.token })).status, 404);
  assert.equal((await addAccount(u, { name: 'X', kind: 'bitcoin', balance: 1 })).status, 400);
  assert.equal((await addAccount(u, { name: '', kind: 'cash', balance: 1 })).status, 400);
  assert.equal((await addAccount(u, { name: 'X', kind: 'cash', balance: 'lots' })).status, 400);
  assert.equal((await addAccount(u, { name: 'X', kind: 'cash', balance: 1, asOf: '2026-13-01' })).status, 400);
});
