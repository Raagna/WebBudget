// A household's "who owes what" tab.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');
const { splitEqually, netBalances, settleUp } = require('../utils/debts');

let env;
let api;
before(async () => {
  env = await start('debts');
  api = client(env.origin);
});
after(() => env.stop());

// Sam owns a household and invites Alex and Jo, who accept.
async function household() {
  const sam = await newUser(api, 'Sam');
  const alex = await newUser(api, 'Alex');
  const jo = await newUser(api, 'Jo');
  const p = await api('POST', '/profiles', { token: sam.token, body: { name: 'Flat', currency: 'CAD' } });
  const profileId = p.body.id;
  for (const u of [alex, jo]) {
    await api('POST', `/profiles/${profileId}/members`, { token: sam.token, body: { email: u.email } });
    await api('POST', `/profiles/invites/${profileId}/accept`, { token: u.token });
  }
  return { sam, alex, jo, profileId };
}

const tab = (u, profileId) => api('GET', `/debts?profileId=${profileId}`, { token: u.token });
const addCost = (u, body) => api('POST', '/debts', { token: u.token, body });
const pay = (u, body) => api('POST', '/debts/payments', { token: u.token, body });

test('equal splits never lose a cent, and settling up takes the fewest payments', () => {
  assert.deepEqual(splitEqually(10000, [1, 2, 3]).map((s) => s.amountCents), [3334, 3333, 3333]);
  assert.deepEqual(splitEqually(1, [1, 2]).map((s) => s.amountCents), [1, 0]);

  // A paid 90 for A, B, C; B paid 30 for B and C.
  const net = netBalances([
    { paidBy: 'A', amountCents: 9000, shares: splitEqually(9000, ['A', 'B', 'C']) },
    { paidBy: 'B', amountCents: 3000, shares: splitEqually(3000, ['B', 'C']) },
  ]);
  assert.deepEqual(Object.fromEntries(net), { A: 6000, B: -1500, C: -4500 });
  assert.deepEqual(settleUp(net), [
    { from: 'C', to: 'A', amountCents: 4500 },
    { from: 'B', to: 'A', amountCents: 1500 },
  ]);
  assert.deepEqual(settleUp(new Map([['A', 0]])), []);
});

test('a shared cost split equally shows up in everyone’s balance', async () => {
  const { sam, alex, jo, profileId } = await household();
  const res = await addCost(sam, {
    profileId, description: 'Costco run', amount: 120, date: '2026-10-10', paidBy: sam.id,
    split: 'equal', between: [sam.id, alex.id, jo.id],
  });
  assert.equal(res.status, 201, res.text);

  const forAlex = await tab(alex, profileId);
  assert.equal(forAlex.status, 200, forAlex.text);
  assert.equal(forAlex.body.yourNet, -40);
  assert.equal((await tab(sam, profileId)).body.yourNet, 80);
  const names = new Map(forAlex.body.members.map((m) => [m.id, m.name]));
  assert.deepEqual(forAlex.body.settleUp.map((p) => [names.get(p.from), names.get(p.to), p.amount]).sort(), [
    ['Alex', 'Sam', 40],
    ['Jo', 'Sam', 40],
  ]);
  const entry = forAlex.body.entries[0];
  assert.equal(entry.description, 'Costco run');
  assert.equal(entry.paidByName, 'Sam');
  assert.equal(entry.canDelete, false); // Alex didn't add it and isn't the owner
});

test('custom shares must add up, and paying back squares the tab', async () => {
  const { sam, alex, profileId } = await household();
  const bad = await addCost(alex, {
    profileId, description: 'Dinner', amount: 100, date: '2026-10-11', paidBy: alex.id,
    split: 'custom', shares: [{ userId: alex.id, amount: 30 }, { userId: sam.id, amount: 60 }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /add up to 90\.00, not 100\.00/);

  const ok = await addCost(alex, {
    profileId, description: 'Dinner', amount: 100, date: '2026-10-11', paidBy: alex.id,
    split: 'custom', shares: [{ userId: alex.id, amount: 30 }, { userId: sam.id, amount: 70 }],
  });
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await tab(sam, profileId)).body.yourNet, -70);

  assert.equal((await pay(sam, { profileId, from: sam.id, to: alex.id, amount: 70, date: '2026-10-12', note: 'e-Transfer' })).status, 201);
  const after = await tab(sam, profileId);
  assert.equal(after.body.yourNet, 0);
  assert.deepEqual(after.body.settleUp, []);
  assert.equal(after.body.entries[0].kind, 'payment');
  assert.equal(after.body.entries[0].description, 'e-Transfer');
});

test('only household members are on the tab, and only they can add to it', async () => {
  const { sam, alex, profileId } = await household();
  const outsider = await newUser(api, 'Outsider');
  assert.equal((await tab(outsider, profileId)).status, 404);
  assert.equal((await addCost(outsider, {
    profileId, description: 'Sneaky', amount: 10, date: '2026-10-10', paidBy: outsider.id, split: 'equal', between: [outsider.id],
  })).status, 404);
  // A member can't charge someone outside the household either.
  assert.equal((await addCost(sam, {
    profileId, description: 'Wrong', amount: 10, date: '2026-10-10', paidBy: sam.id, split: 'equal', between: [sam.id, outsider.id],
  })).status, 400);
  assert.equal((await pay(alex, { profileId, from: alex.id, to: alex.id, amount: 5, date: '2026-10-10' })).status, 400);
  assert.equal((await addCost(sam, { profileId, description: '', amount: 10, date: '2026-10-10', paidBy: sam.id, split: 'equal', between: [sam.id] })).status, 400);
});

test('whoever added an entry, or the owner, can delete it', async () => {
  const { sam, alex, jo, profileId } = await household();
  const { body } = await addCost(alex, {
    profileId, description: 'Pizza', amount: 30, date: '2026-10-10', paidBy: alex.id, split: 'equal', between: [alex.id, jo.id, sam.id],
  });
  assert.equal((await api('DELETE', `/debts/${body.id}`, { token: jo.token })).status, 403);
  assert.equal((await api('DELETE', `/debts/${body.id}`, { token: sam.token })).status, 204); // owner
  assert.equal((await tab(alex, profileId)).body.entries.length, 0);

  const again = await addCost(alex, {
    profileId, description: 'Pizza', amount: 30, date: '2026-10-10', paidBy: alex.id, split: 'equal', between: [alex.id, jo.id],
  });
  assert.equal((await api('DELETE', `/debts/${again.body.id}`, { token: alex.token })).status, 204); // its author
});

test('a member who deletes their account still counts, as a former member', async () => {
  const { sam, alex, profileId } = await household();
  await addCost(alex, {
    profileId, description: 'Groceries', amount: 50, date: '2026-10-10', paidBy: alex.id, split: 'equal', between: [alex.id, sam.id],
  });
  const del = await api('DELETE', '/auth/account', { token: alex.token, body: { password: alex.password } });
  assert.ok(del.status < 300, del.text);

  const after = await tab(sam, profileId);
  assert.equal(after.body.yourNet, -25); // Sam still owes the 25
  const former = after.body.balances.find((b) => b.id === null);
  assert.equal(former.name, 'Former member');
  assert.equal(former.net, 25);
  assert.equal(after.body.settleUp[0].toName, 'Former member');
});
