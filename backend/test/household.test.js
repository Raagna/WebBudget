const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('household');
  api = client(env.origin);
});
after(() => env.stop());

async function household() {
  const a = await newUser(api, 'Alex');
  const b = await newUser(api, 'Sam');
  const id = (await api('POST', '/profiles', { token: a.token, body: { name: 'Home' } })).body.id;
  await api('POST', `/profiles/${id}/members`, { token: a.token, body: { email: b.email } });
  await api('POST', `/profiles/invites/${id}/accept`, { token: b.token });
  return { a, b, id };
}

test('each transaction says which member added it', async () => {
  const { a, b, id } = await household();
  const added = await addTransaction(api, a.token, id, { description: 'Groceries' });
  assert.deepEqual(added.addedBy, { id: a.id, name: 'Alex' }, 'returned right after adding');
  await addTransaction(api, b.token, id, { description: 'Gas' });

  const list = await api('GET', `/transactions?profileId=${id}`, { token: b.token });
  const byDesc = Object.fromEntries(list.body.transactions.map((t) => [t.description, t.addedBy?.name]));
  assert.deepEqual(byDesc, { Groceries: 'Alex', Gas: 'Sam' });
});

test('the list can be filtered to one member', async () => {
  const { a, b, id } = await household();
  await addTransaction(api, a.token, id, { description: 'Mine' });
  await addTransaction(api, b.token, id, { description: 'Theirs' });
  const res = await api('GET', `/transactions?profileId=${id}&addedBy=${b.id}`, { token: a.token });
  assert.deepEqual(res.body.transactions.map((t) => t.description), ['Theirs']);
});

test('after a member deletes their account, their transactions stay with no author', async () => {
  const { a, b, id } = await household();
  await addTransaction(api, b.token, id, { description: 'Left behind' });
  assert.equal((await api('DELETE', '/auth/account', { token: b.token, body: { password: b.password } })).status, 204);
  const list = await api('GET', `/transactions?profileId=${id}`, { token: a.token });
  assert.equal(list.body.transactions[0].description, 'Left behind');
  assert.equal(list.body.transactions[0].addedBy, null);
});
