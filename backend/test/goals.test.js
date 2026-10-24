// Savings goals and the money put toward them.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');
// From utils, not routes/goals: requiring a route file here would open the
// database pool before start() points it at this test's own schema.
const { monthsLeft } = require('../utils/period');

let env;
let api;
before(async () => {
  env = await start('goals');
  api = client(env.origin);
});
after(() => env.stop());

const TODAY = '2026-10-19';
const goals = (u) => api('GET', `/goals?profileId=${u.profileId}&today=${TODAY}`, { token: u.token });
const create = (u, body) => api('POST', '/goals', { token: u.token, body: { profileId: u.profileId, ...body } });
const put = (u, id, amount) => api('POST', `/goals/${id}/contributions`, { token: u.token, body: { amount, date: TODAY } });

test('months left counts this month through the target month', () => {
  assert.equal(monthsLeft('2026-10-19', '2026-12-31'), 3);
  assert.equal(monthsLeft('2026-10-19', '2026-10-31'), 1);
  assert.equal(monthsLeft('2026-10-19', '2027-10-01'), 13);
});

test('a goal shows what is saved and what to put in each month', async () => {
  const u = await newUser(api, 'Saver');
  const res = await create(u, { name: 'Emergency fund', target: 3000, targetDate: '2026-12-31', startingAmount: 600 });
  assert.equal(res.status, 201, res.text);

  let g = (await goals(u)).body.goals[0];
  assert.deepEqual([g.saved, g.remaining, g.percent, g.monthsLeft, g.perMonth, g.status], [600, 2400, 20, 3, 800, 'saving']);

  assert.equal((await put(u, res.body.id, 400)).status, 201);
  assert.equal((await put(u, res.body.id, -100)).status, 201); // took some back out
  g = (await goals(u)).body.goals[0];
  assert.equal(g.saved, 900);
  assert.equal(g.perMonth, 700);

  // Can't take out more than is saved.
  const tooMuch = await put(u, res.body.id, -1000);
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body.error, /900\.00/);

  const hist = await api('GET', `/goals/${res.body.id}/contributions`, { token: u.token });
  assert.deepEqual(hist.body.contributions.map((c) => c.amount).sort((a, b) => a - b), [-100, 400, 600]);
});

test('reached and overdue goals say so; reached goals sort last', async () => {
  const u = await newUser(api, 'Finisher');
  const done = await create(u, { name: 'New phone', target: 500, startingAmount: 500 });
  await create(u, { name: 'Old plan', target: 200, targetDate: '2026-01-01' });
  await create(u, { name: 'Someday', target: 100 });
  const list = (await goals(u)).body.goals;
  assert.deepEqual(list.map((g) => [g.name, g.status]), [['Old plan', 'overdue'], ['Someday', 'saving'], ['New phone', 'reached']]);
  assert.equal(list.find((g) => g.name === 'Someday').perMonth, null); // no date, no monthly amount

  assert.equal((await api('PUT', `/goals/${done.body.id}`, { token: u.token, body: { target: 800 } })).status, 200);
  const raised = (await goals(u)).body.goals.find((g) => g.name === 'New phone');
  assert.deepEqual([raised.status, raised.remaining], ['saving', 300]);
});

test('goals belong to the profile: outsiders can’t see or change them', async () => {
  const u = await newUser(api, 'Owner');
  const other = await newUser(api, 'Other');
  const { body } = await create(u, { name: 'Trip', target: 1000 });
  assert.equal((await api('GET', `/goals?profileId=${u.profileId}`, { token: other.token })).status, 404);
  assert.equal((await put(other, body.id, 10)).status, 404);
  assert.equal((await api('DELETE', `/goals/${body.id}`, { token: other.token })).status, 404);
  assert.equal((await create(u, { name: '', target: 10 })).status, 400);
  assert.equal((await create(u, { name: 'X', target: 0 })).status, 400);
  assert.equal((await create(u, { name: 'X', target: 10, targetDate: '2026-02-31' })).status, 400);
  assert.equal((await api('DELETE', `/goals/${body.id}`, { token: u.token })).status, 204);
});
