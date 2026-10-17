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

test('safe to spend sets aside unpaid bills and scheduled expenses, and spreads the rest per day', async () => {
  const u = await newUser(api, 'Safe');
  const bill = (body) => api('POST', '/bills', { token: u.token, body: { profileId: u.profileId, ...body } });
  await addTransaction(api, u.token, u.profileId, { type: 'income', amount: 3000, date: '2026-10-01', description: 'Pay' });
  await addTransaction(api, u.token, u.profileId, { amount: 400, date: '2026-10-10', description: 'Groceries' });
  await addTransaction(api, u.token, u.profileId, { amount: 1200, date: '2026-10-28', description: 'Rent (scheduled)' });
  await bill({ name: 'Hydro', amount: 84.12, dueOn: '2026-10-23' }); // due later this month
  await bill({ name: 'Phone', amount: 60, dueOn: '2026-10-05' }); // overdue, still owed
  await bill({ name: 'Insurance', amount: 150, dueOn: '2026-11-02' }); // next month: not counted
  const paid = await bill({ name: 'Internet', amount: 70, dueOn: '2026-10-20' });
  assert.equal((await api('POST', `/bills/${paid.body.id}/pay`, { token: u.token, body: {} })).status, 200);

  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-10-15`, { token: u.token });
  assert.equal(res.status, 200, res.text);
  const s = res.body.safeToSpend;
  assert.equal(s.billsDue, 144.12, 'Hydro + overdue Phone; not next month, not paid');
  assert.equal(s.scheduled, 1200);
  assert.equal(s.amount, 3000 - 400 - 144.12 - 1200); // 1255.88
  assert.equal(s.daysLeft, 17); // Oct 15..31
  assert.equal(s.perDay, 73.87); // floor(1255.88 / 17) to the cent
  assert.deepEqual(s.upcomingBills.map((b) => [b.name, b.overdue]), [['Phone', true], ['Hydro', false]]);
});

test('safe to spend can go negative, and is only given for the current month', async () => {
  const u = await newUser(api, 'Tight');
  await addTransaction(api, u.token, u.profileId, { type: 'income', amount: 500, date: '2026-10-01' });
  await addTransaction(api, u.token, u.profileId, { amount: 700, date: '2026-10-02' });
  const now = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-10-15`, { token: u.token });
  assert.equal(now.body.safeToSpend.amount, -200);
  assert.equal(now.body.safeToSpend.perDay, 0);

  const past = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-10-15&month=2026-09`, { token: u.token });
  assert.equal(past.body.safeToSpend, null);
});

test('the comparison with last month covers the same stretch of days, not the whole month', async () => {
  const u = await newUser(api, 'Compare');
  await addTransaction(api, u.token, u.profileId, { amount: 100, date: '2026-09-05' }); // inside Sep 1..17
  await addTransaction(api, u.token, u.profileId, { amount: 900, date: '2026-09-25' }); // after the 17th: not compared
  await addTransaction(api, u.token, u.profileId, { amount: 60, date: '2026-10-03' });
  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-10-17`, { token: u.token });
  assert.deepEqual(res.body.lastMonthToDate, { from: '2026-09-01', to: '2026-09-17', income: 0, expenses: 100 });
});

test('a short previous month is clamped: Mar 31 compares with Feb 1..28', async () => {
  const u = await newUser(api, 'Clamp');
  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-03-31`, { token: u.token });
  assert.equal(res.body.lastMonthToDate.to, '2026-02-28');
  const jan = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-01-10`, { token: u.token });
  assert.equal(jan.body.lastMonthToDate.from, '2025-12-01', 'January compares with December of the year before');
});

test('an invalid today falls back to the server date instead of erroring', async () => {
  const u = await newUser(api, 'Fallback');
  const res = await api('GET', `/dashboard/summary?profileId=${u.profileId}&today=2026-02-31`, { token: u.token });
  assert.equal(res.status, 200, res.text);
});
