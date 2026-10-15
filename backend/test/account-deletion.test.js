const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('account_deletion');
  api = client(env.origin);
});
after(() => env.stop());

// Owner A creates a household and adds B as an active member.
async function sharedHousehold() {
  const a = await newUser(api, 'Alice');
  const b = await newUser(api, 'Bob');
  const created = await api('POST', '/profiles', { token: a.token, body: { name: 'Household' } });
  const householdId = created.body.id;
  await api('POST', `/profiles/${householdId}/members`, { token: a.token, body: { email: b.email } });
  const accepted = await api('POST', `/profiles/invites/${householdId}/accept`, { token: b.token });
  assert.equal(accepted.status, 204, accepted.text);
  return { a, b, householdId };
}

async function transactionsIn(token, profileId) {
  const res = await api('GET', `/transactions?profileId=${profileId}`, { token });
  assert.equal(res.status, 200, res.text);
  return res.body.transactions;
}

test('deleting the creator of a household keeps it for the new owner', async () => {
  const { a, b, householdId } = await sharedHousehold();
  await addTransaction(api, a.token, householdId, { description: 'Groceries by Alice' });
  await addTransaction(api, b.token, householdId, { description: 'Rent by Bob' });

  // A hands the household over to B, steps down, then deletes their account.
  assert.equal((await api('POST', `/profiles/${householdId}/members/${b.id}/promote`, { token: a.token })).status, 204);
  assert.equal((await api('POST', `/profiles/${householdId}/members/${a.id}/demote`, { token: a.token })).status, 204);
  const del = await api('DELETE', '/auth/account', { token: a.token, body: { password: a.password } });
  assert.equal(del.status, 204, del.text);

  // Before the fix, profiles.user_id ON DELETE CASCADE wiped the household
  // (and everything in it) for B as well.
  const left = await transactionsIn(b.token, householdId);
  assert.deepEqual(left.map((t) => t.description).sort(), ['Groceries by Alice', 'Rent by Bob']);
});

test("a member deleting their account keeps the transactions they entered", async () => {
  const { a, b, householdId } = await sharedHousehold();
  await addTransaction(api, b.token, householdId, { description: 'Entered by Bob' });

  const del = await api('DELETE', '/auth/account', { token: b.token, body: { password: b.password } });
  assert.equal(del.status, 204, del.text);

  const left = await transactionsIn(a.token, householdId);
  assert.deepEqual(left.map((t) => t.description), ['Entered by Bob']);
});

test('the only owner of a shared household cannot delete their account', async () => {
  const { a, b, householdId } = await sharedHousehold();
  const del = await api('DELETE', '/auth/account', { token: a.token, body: { password: a.password } });
  assert.equal(del.status, 400);
  assert.match(del.body.error, /only owner/);
  assert.equal((await transactionsIn(b.token, householdId)).length, 0); // household still reachable
});

test('a co-owner can delete their account without removing anyone', async () => {
  const { a, b, householdId } = await sharedHousehold();
  await api('POST', `/profiles/${householdId}/members/${b.id}/promote`, { token: a.token });
  const del = await api('DELETE', '/auth/account', { token: a.token, body: { password: a.password } });
  assert.equal(del.status, 204, del.text);
  const profiles = await api('GET', '/profiles', { token: b.token });
  assert.ok(profiles.body.profiles.some((p) => p.id === householdId));
});

test("a user's private profiles are deleted with their account", async () => {
  const solo = await newUser(api, 'Solo');
  await addTransaction(api, solo.token, solo.profileId);
  const del = await api('DELETE', '/auth/account', { token: solo.token, body: { password: solo.password } });
  assert.equal(del.status, 204, del.text);

  const rows = await env.db.query('SELECT COUNT(*)::int AS n FROM profiles WHERE id = ?', [solo.profileId]);
  assert.equal(rows[0].n, 0);
  const tx = await env.db.query('SELECT COUNT(*)::int AS n FROM transactions WHERE profile_id = ?', [solo.profileId]);
  assert.equal(tx[0].n, 0);
});

test('a wrong confirmation password is 403, not 401, so the app does not log the user out', async () => {
  const u = await newUser(api, 'Typo');
  const del = await api('DELETE', '/auth/account', { token: u.token, body: { password: 'wrong-password' } });
  assert.equal(del.status, 403);
  assert.equal(del.body.error, 'Incorrect password');
});
