const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('budgets');
  api = client(env.origin);
});
after(() => env.stop());

async function categoryId(token, name) {
  const res = await api('GET', '/categories', { token });
  const c = res.body.categories.find((x) => x.name === name);
  assert.ok(c, `category ${name} exists`);
  return c.id;
}

test('a budget shows what has been spent in its category this month, up to today', async () => {
  const u = await newUser(api, 'Budgeter');
  const food = await categoryId(u.token, 'Food');
  const set = await api('PUT', '/budgets', { token: u.token, body: { profileId: u.profileId, categoryId: food, amount: 400 } });
  assert.equal(set.status, 200, set.text);

  await addTransaction(api, u.token, u.profileId, { categoryId: food, amount: 120.5, date: '2026-10-03' });
  await addTransaction(api, u.token, u.profileId, { categoryId: food, amount: 60, date: '2026-10-12' });
  await addTransaction(api, u.token, u.profileId, { categoryId: food, amount: 999, date: '2026-10-25' }); // after "today"
  await addTransaction(api, u.token, u.profileId, { categoryId: food, amount: 75, date: '2026-09-28' }); // last month, later than "today"'s day
  await addTransaction(api, u.token, u.profileId, { categoryId: food, amount: 40, date: '2026-09-10' }); // last month, same stretch
  await addTransaction(api, u.token, u.profileId, { amount: 30, date: '2026-10-05' }); // uncategorized

  const res = await api('GET', `/budgets?profileId=${u.profileId}&today=2026-10-15`, { token: u.token });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.month, '2026-10');
  assert.equal(res.body.daysLeft, 17);
  const [b] = res.body.budgets;
  assert.equal(b.categoryName, 'Food');
  assert.equal(b.amount, 400);
  assert.equal(b.spent, 180.5);
  assert.equal(b.remaining, 219.5);
  assert.equal(b.percent, 45);
  // Compared with Sep 1..15 only: the Sep 10 purchase counts, Sep 28 does not.
  assert.equal(b.lastMonthSpent, 40);
  assert.equal(res.body.totals.lastMonthSpent, 40);
  assert.equal(res.body.totals.unbudgetedSpent, 30);
});

test('setting a budget again updates it, and over-budget shows a negative remaining', async () => {
  const u = await newUser(api, 'Updater');
  const fun = await categoryId(u.token, 'Entertainment');
  await api('PUT', '/budgets', { token: u.token, body: { profileId: u.profileId, categoryId: fun, amount: 100 } });
  await api('PUT', '/budgets', { token: u.token, body: { profileId: u.profileId, categoryId: fun, amount: 50 } });
  await addTransaction(api, u.token, u.profileId, { categoryId: fun, amount: 80, date: '2026-10-02' });

  const res = await api('GET', `/budgets?profileId=${u.profileId}&today=2026-10-15`, { token: u.token });
  assert.equal(res.body.budgets.length, 1);
  assert.equal(res.body.budgets[0].amount, 50);
  assert.equal(res.body.budgets[0].remaining, -30);
  assert.equal(res.body.budgets[0].percent, 160);
  assert.equal(res.body.totals.remaining, 0, 'an overspent budget adds nothing to what is left');
});

test('budgets are shared by a household, and outsiders cannot see or delete them', async () => {
  const a = await newUser(api, 'Owner');
  const b = await newUser(api, 'Partner');
  const outsider = await newUser(api, 'Outsider');
  const household = (await api('POST', '/profiles', { token: a.token, body: { name: 'Home' } })).body.id;
  await api('POST', `/profiles/${household}/members`, { token: a.token, body: { email: b.email } });
  await api('POST', `/profiles/invites/${household}/accept`, { token: b.token });

  const groceries = await categoryId(a.token, 'Food');
  const set = await api('PUT', '/budgets', { token: a.token, body: { profileId: household, categoryId: groceries, amount: 600 } });
  await addTransaction(api, b.token, household, { categoryId: groceries, amount: 90, date: '2026-10-08' });

  const seenByB = await api('GET', `/budgets?profileId=${household}&today=2026-10-15`, { token: b.token });
  assert.equal(seenByB.body.budgets[0].spent, 90, "the partner's spending counts against the shared budget");

  assert.equal((await api('GET', `/budgets?profileId=${household}`, { token: outsider.token })).status, 404);
  assert.equal((await api('PUT', '/budgets', { token: outsider.token, body: { profileId: household, categoryId: groceries, amount: 1 } })).status, 404);
  assert.equal((await api('DELETE', `/budgets/${set.body.id}`, { token: outsider.token })).status, 404);
  assert.equal((await api('DELETE', `/budgets/${set.body.id}`, { token: b.token })).status, 204);
});

test('income categories and invalid amounts are rejected', async () => {
  const u = await newUser(api, 'Strict');
  const salary = await categoryId(u.token, 'Salary/Income');
  const income = await api('PUT', '/budgets', { token: u.token, body: { profileId: u.profileId, categoryId: salary, amount: 100 } });
  assert.equal(income.status, 400);
  const food = await categoryId(u.token, 'Food');
  const zero = await api('PUT', '/budgets', { token: u.token, body: { profileId: u.profileId, categoryId: food, amount: 0 } });
  assert.equal(zero.status, 400);
});
