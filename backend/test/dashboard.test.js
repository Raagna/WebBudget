const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('dashboard');
  api = client(env.origin);
});
after(() => env.stop());

test("this month's totals only count transactions up to the user's today", async () => {
  const u = await newUser(api, 'Planner');
  await addTransaction(api, u.token, u.profileId, { type: 'income', amount: 1000, date: '2026-10-01', description: 'Pay' });
  await addTransaction(api, u.token, u.profileId, { amount: 40, date: '2026-10-14', description: 'Groceries' });
  await addTransaction(api, u.token, u.profileId, { amount: 1200, date: '2026-10-28', description: 'Rent (scheduled)' });

  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-10-15`, { token: u.token });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.month, '2026-10');
  assert.equal(res.body.income, 1000);
  assert.equal(res.body.expenses, 40, 'rent dated the 28th has not been spent yet on the 15th');
  assert.ok(!res.body.recentTransactions.some((t) => t.description === 'Rent (scheduled)'));

  // Once the date arrives, it counts.
  const later = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-10-30`, { token: u.token });
  assert.equal(later.body.expenses, 1240);
});

test("the current month comes from the user's date, not the server's UTC date", async () => {
  const u = await newUser(api, 'Evening');
  await addTransaction(api, u.token, u.profileId, { amount: 25, date: '2025-03-31', description: 'End of March' });
  // E.g. 9pm on Mar 31 in Toronto is already Apr 1 in UTC; the browser says
  // it's still the 31st, so the dashboard must show March. A date far from
  // the real one makes sure the server's own clock isn't what's used.
  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2025-03-31`, { token: u.token });
  assert.equal(res.body.month, '2025-03');
  assert.equal(res.body.expenses, 25);
});

test('the trend chart stops at the same "today" as the cards', async () => {
  const u = await newUser(api, 'Trends');
  await addTransaction(api, u.token, u.profileId, { amount: 50, date: '2026-10-10' });
  await addTransaction(api, u.token, u.profileId, { amount: 500, date: '2026-10-25' });
  const res = await api('GET', `/dashboard/trends?profileId=${u.profileId}&months=3&today=2026-10-15`, { token: u.token });
  assert.equal(res.status, 200, res.text);
  const oct = res.body.trends.find((m) => m.month === '2026-10');
  assert.equal(oct.expenses, 50);
});

test('an invalid today falls back to the server date instead of erroring', async () => {
  const u = await newUser(api, 'Fallback');
  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-02-31`, { token: u.token });
  assert.equal(res.status, 200, res.text);
});
