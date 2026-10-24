// Searching the transaction list, and paging through it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('transactions_search');
  api = client(env.origin);
});
after(() => env.stop());

const list = (u, query) => api('GET', `/transactions?profileId=${u.profileId}&${query}`, { token: u.token });

test('search matches the description, the category name or an exact amount', async () => {
  const u = await newUser(api, 'Searcher');
  const cats = new Map((await api('GET', '/categories', { token: u.token })).body.categories.map((c) => [c.name, c.id]));
  await addTransaction(api, u.token, u.profileId, { description: 'Costco run', amount: 126.45 });
  await addTransaction(api, u.token, u.profileId, { description: 'Hydro bill', amount: 84.12, categoryId: cats.get('Utilities') });
  await addTransaction(api, u.token, u.profileId, { description: '100% juice', amount: 5 });

  const descs = async (q) => (await list(u, `q=${encodeURIComponent(q)}`)).body.transactions.map((t) => t.description).sort();
  assert.deepEqual(await descs('costco'), ['Costco run']);
  assert.deepEqual(await descs('utilities'), ['Hydro bill']); // by category
  assert.deepEqual(await descs('$84.12'), ['Hydro bill']); // by amount
  assert.deepEqual(await descs('%'), ['100% juice']); // % is literal, not a wildcard
  assert.deepEqual(await descs('nothing like this'), []);
  assert.equal((await list(u, 'q=costco')).body.total, 1);
});

test('paging walks the whole list once, with no repeats, even on equal dates', async () => {
  const u = await newUser(api, 'Pager');
  for (let n = 0; n < 7; n++) await addTransaction(api, u.token, u.profileId, { description: `Item ${n}`, date: '2026-10-01' });
  const seen = [];
  for (let offset = 0; offset < 7; offset += 3) {
    const page = await list(u, `limit=3&offset=${offset}`);
    assert.equal(page.body.total, 7);
    seen.push(...page.body.transactions.map((t) => t.id));
  }
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
});
