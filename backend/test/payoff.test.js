// The debt payoff plan's API: a profile's own loans and cards.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('payoff');
  api = client(env.origin);
});
after(() => env.stop());

const plan = (u, profileId, today = '2026-10-19') => api('GET', `/payoff?profileId=${profileId}&today=${today}`, { token: u.token });
const addDebt = (u, body) => api('POST', '/payoff/debts', { token: u.token, body });

test('an empty plan has no debts and nothing to pay off', async () => {
  const u = await newUser(api, 'Empty');
  const res = await plan(u, u.profileId);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.debts, []);
  assert.equal(res.body.extra, 0);
  assert.equal(res.body.strategy, 'avalanche');
  assert.equal(res.body.plans.avalanche.paidOff, true);
  assert.equal(res.body.plans.avalanche.months, 0);
  assert.deepEqual(res.body.plans.avalanche.balances, [0]);
});

test('debts go in, and the plans compare avalanche, snowball and minimums only', async () => {
  const u = await newUser(api, 'Borrower');
  const card = await addDebt(u, { profileId: u.profileId, name: 'TD Visa', balance: 5000, rate: 22, minPayment: 100 });
  assert.equal(card.status, 201, card.text);
  const car = await addDebt(u, { profileId: u.profileId, name: 'Car loan', balance: 1000, rate: 5, minPayment: 50 });
  assert.equal(car.status, 201, car.text);
  const extra = await api('PUT', '/payoff/settings', { token: u.token, body: { profileId: u.profileId, extra: 200 } });
  assert.equal(extra.status, 200, extra.text);
  assert.deepEqual(extra.body, { extra: 200, strategy: 'avalanche' });

  const res = await plan(u, u.profileId);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.thisMonth, '2026-10');
  assert.equal(res.body.extra, 200);
  assert.deepEqual(res.body.debts.map((d) => [d.name, d.balance, d.rate, d.minPayment]), [
    ['TD Visa', 5000, 22, 100],
    ['Car loan', 1000, 5, 50],
  ]);
  assert.equal(res.body.debts[0].monthlyInterest, 91.67);
  assert.deepEqual(res.body.totals, { balance: 6000, minPayments: 150 });

  // Same numbers as the maths tests (test/payoff-math.test.js), in dollars.
  const { avalanche, snowball, minimum } = res.body.plans;
  assert.equal(avalanche.months, 21);
  assert.equal(avalanche.debtFreeMonth, '2028-07'); // first payment is next month
  assert.equal(avalanche.totalInterest, 1067.92);
  assert.equal(snowball.totalInterest, 1218.64);
  assert.deepEqual(snowball.order.map((o) => [o.name, o.month]), [['Car loan', '2027-03'], ['TD Visa', '2028-07']]);
  assert.equal(minimum.months, 137);
  assert.equal(minimum.totalInterest, 8724.65);
  assert.equal(avalanche.balances.length, 22);
  assert.equal(avalanche.balances[0], 6000);
  assert.equal(avalanche.balances.at(-1), 0);

  const snow = await api('PUT', '/payoff/settings', { token: u.token, body: { profileId: u.profileId, strategy: 'snowball' } });
  assert.deepEqual(snow.body, { extra: 200, strategy: 'snowball' }, 'changing the plan keeps the extra');
});

test('a minimum that never covers the interest is flagged', async () => {
  const u = await newUser(api, 'Stuck');
  await addDebt(u, { profileId: u.profileId, name: 'Store card', balance: 10000, rate: 24, minPayment: 150 });
  const res = await plan(u, u.profileId);
  const [d] = res.body.debts;
  assert.equal(d.minimumTooLow, true);
  assert.equal(d.monthlyInterest, 200);
  assert.equal(res.body.plans.minimum.paidOff, false);
  assert.equal(res.body.plans.minimum.debtFreeMonth, null);
  assert.deepEqual(res.body.plans.minimum.unpaid, [{ id: d.id, name: 'Store card' }]);
  assert.equal(res.body.plans.avalanche.paidOff, false, 'no extra either, so no plan clears it');

  await api('PUT', '/payoff/settings', { token: u.token, body: { profileId: u.profileId, extra: 300 } });
  const better = await plan(u, u.profileId);
  assert.equal(better.body.plans.avalanche.paidOff, true);
  assert.equal(better.body.plans.minimum.paidOff, false);
});

test('a debt can be updated and deleted', async () => {
  const u = await newUser(api, 'Updater');
  const { body: { id } } = await addDebt(u, { profileId: u.profileId, name: 'OSAP', balance: 12000, rate: 6.2, minPayment: 150 });
  const upd = await api('PUT', `/payoff/debts/${id}`, { token: u.token, body: { name: 'OSAP', balance: 11850.5, rate: 6.45, minPayment: 0 } });
  assert.equal(upd.status, 200, upd.text);
  const [d] = (await plan(u, u.profileId)).body.debts;
  assert.deepEqual([d.balance, d.rate, d.minPayment, d.minimumTooLow], [11850.5, 6.45, 0, true]);

  assert.equal((await api('DELETE', `/payoff/debts/${id}`, { token: u.token })).status, 204);
  assert.deepEqual((await plan(u, u.profileId)).body.debts, []);
  assert.equal((await api('DELETE', `/payoff/debts/${id}`, { token: u.token })).status, 404);
});

test('bad input is turned away with a plain reason', async () => {
  const u = await newUser(api, 'Careful');
  const base = { profileId: u.profileId, name: 'Visa', balance: 100, rate: 19.99, minPayment: 10 };
  for (const [change, pattern] of [
    [{ name: '  ' }, /name/],
    [{ balance: 0 }, /still owe/],
    [{ balance: '100' }, /still owe/],
    [{ rate: -1 }, /interest rate/],
    [{ rate: 101 }, /interest rate/],
    [{ minPayment: -5 }, /minimum/],
  ]) {
    const res = await addDebt(u, { ...base, ...change });
    assert.equal(res.status, 400, JSON.stringify(change));
    assert.match(res.body.error, pattern);
  }
  const s = (body) => api('PUT', '/payoff/settings', { token: u.token, body: { profileId: u.profileId, ...body } });
  assert.equal((await s({ extra: -1 })).status, 400);
  assert.equal((await s({ strategy: 'random' })).status, 400);
  assert.equal((await s({})).status, 400);
  assert.equal((await s({ extra: 0 })).status, 200);
});

test('a household shares one plan, and outsiders cannot see or touch it', async () => {
  const a = await newUser(api, 'Owner');
  const b = await newUser(api, 'Partner');
  const outsider = await newUser(api, 'Outsider');
  const household = (await api('POST', '/profiles', { token: a.token, body: { name: 'Home' } })).body.id;
  await api('POST', `/profiles/${household}/members`, { token: a.token, body: { email: b.email } });
  await api('POST', `/profiles/invites/${household}/accept`, { token: b.token });

  const { body: { id } } = await addDebt(a, { profileId: household, name: 'Mortgage LOC', balance: 20000, rate: 7.2, minPayment: 300 });
  assert.equal((await plan(b, household)).body.debts[0].name, 'Mortgage LOC');

  assert.equal((await plan(outsider, household)).status, 404);
  assert.equal((await addDebt(outsider, { profileId: household, name: 'x', balance: 1, rate: 1, minPayment: 1 })).status, 404);
  assert.equal((await api('PUT', `/payoff/debts/${id}`, { token: outsider.token, body: { name: 'x', balance: 1, rate: 1, minPayment: 1 } })).status, 404);
  assert.equal((await api('DELETE', `/payoff/debts/${id}`, { token: outsider.token })).status, 404);
  assert.equal((await api('PUT', '/payoff/settings', { token: outsider.token, body: { profileId: household, extra: 5 } })).status, 404);
  assert.equal((await api('GET', '/payoff', { token: outsider.token })).status, 400);

  assert.equal((await api('DELETE', `/payoff/debts/${id}`, { token: b.token })).status, 204);
});
