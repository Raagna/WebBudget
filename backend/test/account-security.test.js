const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');

let env;
let api;
// Reset emails the API "sent", captured instead of printed to the console.
const outbox = [];
let waiting = [];

before(async () => {
  env = await start('account_security');
  api = client(env.origin);
  // routes/auth.js calls mailer.sendPasswordReset through the module
  // object, so replacing it here catches every reset email.
  const mailer = require('../utils/mailer');
  mailer.sendPasswordReset = async (email, token) => {
    outbox.push({ email, token });
    const ready = waiting.filter((w) => w.email === email);
    waiting = waiting.filter((w) => w.email !== email);
    ready.forEach((w) => w.resolve(token));
  };
});
after(() => env.stop());

// /forgot-password answers before it sends anything, so wait for the
// email to "arrive" rather than reading the outbox straight away.
// The email goes to the address as stored, which is lowercased.
function nextResetToken(email) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reset email for ${email}`)), 5000);
    waiting.push({ email: email.toLowerCase(), resolve: (token) => { clearTimeout(timer); resolve(token); } });
  });
}

async function requestReset(email) {
  const tokenArrives = nextResetToken(email);
  const res = await api('POST', '/auth/forgot-password', { body: { email } });
  assert.equal(res.status, 202, res.text);
  return tokenArrives;
}

const login = (email, password) => api('POST', '/auth/login', { body: { email, password } });
const whoCanSee = (token) => api('GET', '/profiles', { token });

// 37 two-byte characters: 37 characters long but 74 bytes in UTF-8.
const LONG_PASSWORD = 'é'.repeat(37);

// ---------- Change password ----------

test('changing the password needs the current one and follows the registration rules', async () => {
  const u = await newUser(api, 'Changer');

  const wrong = await api('POST', '/auth/password', { token: u.token, body: { currentPassword: 'not-it-at-all', newPassword: 'NewPassword456!' } });
  assert.equal(wrong.status, 403, 'a wrong current password must not look like an expired session (401)');

  const short = await api('POST', '/auth/password', { token: u.token, body: { currentPassword: u.password, newPassword: 'short' } });
  assert.equal(short.status, 400);

  const long = await api('POST', '/auth/password', { token: u.token, body: { currentPassword: u.password, newPassword: LONG_PASSWORD } });
  assert.equal(long.status, 400, 'more than 72 bytes is rejected even though it is under 72 characters');

  assert.equal((await login(u.email, u.password)).status, 200, 'none of the rejected attempts changed anything');
});

test('changing the password signs out other sessions but keeps this one', async () => {
  const u = await newUser(api, 'Rotator');
  const otherDevice = (await login(u.email, u.password)).body.token;

  const changed = await api('POST', '/auth/password', { token: u.token, body: { currentPassword: u.password, newPassword: 'NewPassword456!' } });
  assert.equal(changed.status, 200, changed.text);
  assert.ok(changed.body.token);

  assert.equal((await whoCanSee(otherDevice)).status, 401, 'another device must be signed out');
  assert.equal((await whoCanSee(u.token)).status, 401, 'the token used to make the change is replaced too');
  assert.equal((await whoCanSee(changed.body.token)).status, 200, 'the new token works');

  assert.equal((await login(u.email, u.password)).status, 401);
  assert.equal((await login(u.email, 'NewPassword456!')).status, 200);
});

// ---------- Password length cap ----------

test('registration caps passwords at 72 bytes, not 72 characters', async () => {
  const email = () => `cap-${Math.random().toString(36).slice(2, 10)}@example.test`;
  const tooLong = await api('POST', '/auth/register', { body: { name: 'Cap', email: email(), password: LONG_PASSWORD } });
  assert.equal(tooLong.status, 400);
  assert.deepEqual(tooLong.body.fields, ['password']);

  // Exactly 72 bytes is fine. Before the cap, bcrypt ignored everything
  // after byte 72, so "<these 72>anything" would also have logged in.
  const exact = 'a'.repeat(72);
  const e = email();
  const ok = await api('POST', '/auth/register', { body: { name: 'Cap', email: e, password: exact } });
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await login(e, exact)).status, 200);
});

// ---------- Sign out everywhere ----------

test('sign out everywhere ends every session, including the current one', async () => {
  const u = await newUser(api, 'Everywhere');
  const laptop = (await login(u.email, u.password)).body.token;
  assert.equal((await whoCanSee(laptop)).status, 200);

  const out = await api('POST', '/auth/logout-all', { token: u.token });
  assert.equal(out.status, 204, out.text);

  assert.equal((await whoCanSee(u.token)).status, 401);
  assert.equal((await whoCanSee(laptop)).status, 401);

  // Signing in again gives a working token.
  const fresh = await login(u.email, u.password);
  assert.equal((await whoCanSee(fresh.body.token)).status, 200);
});

test('a token stops working once its account is deleted', async () => {
  const u = await newUser(api, 'Gone');
  const del = await api('DELETE', '/auth/account', { token: u.token, body: { password: u.password } });
  assert.equal(del.status, 204, del.text);
  // Before migration 017 the middleware never looked the user up, so this
  // token still passed it for the rest of its 7 days.
  assert.equal((await whoCanSee(u.token)).status, 401);
});

test('tokens signed before token versions existed still work until revoked', async () => {
  const jwt = require('jsonwebtoken');
  const u = await newUser(api, 'Legacy');
  const legacy = jwt.sign({ sub: u.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  assert.equal((await whoCanSee(legacy)).status, 200, 'deploying the migration must not sign everyone out');

  await api('POST', '/auth/logout-all', { token: u.token });
  assert.equal((await whoCanSee(legacy)).status, 401);
});

// ---------- Forgot password ----------

test('forgot password answers the same whether or not the email has an account', async () => {
  const u = await newUser(api, 'Known');
  const sent = outbox.length;
  const unknown = await api('POST', '/auth/forgot-password', { body: { email: 'nobody-here@example.test' } });
  const tokenArrives = nextResetToken(u.email);
  const known = await api('POST', '/auth/forgot-password', { body: { email: u.email } });
  await tokenArrives;

  assert.equal(unknown.status, 202);
  assert.equal(known.status, 202);
  assert.deepEqual(unknown.body, known.body);
  assert.deepEqual(outbox.slice(sent).map((m) => m.email), [u.email], 'only the real account gets an email');
});

test('a reset link sets a new password once, and signs out old sessions', async () => {
  const u = await newUser(api, 'Forgetful');
  // Emails are matched case-insensitively, like login.
  const token = await requestReset(u.email.toUpperCase());

  // Only a hash is stored, never the token from the link.
  const rows = await env.db.query('SELECT token_hash FROM password_resets WHERE user_id = ?', [u.id]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.ok(!rows[0].token_hash.includes(token));

  const tooLong = await api('POST', '/auth/reset-password', { body: { token, password: LONG_PASSWORD } });
  assert.equal(tooLong.status, 400);

  const reset = await api('POST', '/auth/reset-password', { body: { token, password: 'Brand-New-Pass1' } });
  assert.equal(reset.status, 204, reset.text);

  assert.equal((await whoCanSee(u.token)).status, 401, 'whoever had a session before the reset is signed out');
  assert.equal((await login(u.email, u.password)).status, 401);
  assert.equal((await login(u.email, 'Brand-New-Pass1')).status, 200);

  const again = await api('POST', '/auth/reset-password', { body: { token, password: 'Another-Pass22' } });
  assert.equal(again.status, 400, 'a link works only once');
  assert.equal((await login(u.email, 'Brand-New-Pass1')).status, 200);
});

test('a reset link expires after an hour', async () => {
  const u = await newUser(api, 'Late');
  const token = await requestReset(u.email);
  await env.db.run(`UPDATE password_resets SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ?`, [u.id]);

  const res = await api('POST', '/auth/reset-password', { body: { token, password: 'Too-Late-Pass1' } });
  assert.equal(res.status, 400);
  assert.equal((await login(u.email, u.password)).status, 200);
});

test('asking again cancels the earlier link, and so does changing the password', async () => {
  const u = await newUser(api, 'Twice');
  const first = await requestReset(u.email);
  const second = await requestReset(u.email);

  assert.equal((await api('POST', '/auth/reset-password', { body: { token: first, password: 'From-First-Link1' } })).status, 400);

  // The user remembers their password and changes it normally; the link
  // they asked for earlier must not be able to override that.
  const changed = await api('POST', '/auth/password', { token: u.token, body: { currentPassword: u.password, newPassword: 'Remembered-It-1' } });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await api('POST', '/auth/reset-password', { body: { token: second, password: 'From-Second-Link' } })).status, 400);
  assert.equal((await login(u.email, 'Remembered-It-1')).status, 200);
});

test('a made-up reset token is rejected', async () => {
  const res = await api('POST', '/auth/reset-password', { body: { token: 'not-a-real-token', password: 'Whatever-Pass1' } });
  assert.equal(res.status, 400);
});

// ---------- Category ownership on bills and subscriptions ----------

async function privateCategory(owner, name) {
  const res = await api('POST', '/categories', { token: owner.token, body: { name, type: 'expense' } });
  assert.equal(res.status, 201, res.text);
  return res.body.id;
}

test("bills can't use another user's private category", async () => {
  const owner = await newUser(api, 'CatOwner');
  const other = await newUser(api, 'Snoop');
  const secret = await privateCategory(owner, 'Secret therapy');
  const mine = await privateCategory(other, 'My own');

  const bill = { profileId: other.profileId, name: 'Rent', amount: 100, dueOn: '2026-11-01' };
  const stolen = await api('POST', '/bills', { token: other.token, body: { ...bill, categoryId: secret } });
  assert.equal(stolen.status, 400);

  const created = await api('POST', '/bills', { token: other.token, body: { ...bill, categoryId: mine } });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.categoryName, 'My own');

  const edit = await api('PUT', `/bills/${created.body.id}`, { token: other.token, body: { categoryId: secret } });
  assert.equal(edit.status, 400);
  const junk = await api('PUT', `/bills/${created.body.id}`, { token: other.token, body: { categoryId: 'abc' } });
  assert.equal(junk.status, 400, 'a non-numeric id is a 400, not a database error');
});

test("subscriptions can't use another user's private category", async () => {
  const owner = await newUser(api, 'SubOwner');
  const other = await newUser(api, 'SubSnoop');
  const secret = await privateCategory(owner, 'Hidden hobby');

  const sub = { name: 'Streaming', amount: 12, billingCycle: 'monthly', nextBillingOn: '2026-11-05' };
  const stolen = await api('POST', '/subscriptions', { token: other.token, body: { ...sub, categoryId: secret } });
  assert.equal(stolen.status, 400);

  const created = await api('POST', '/subscriptions', { token: other.token, body: sub });
  assert.equal(created.status, 201, created.text);
  const edit = await api('PUT', `/subscriptions/${created.body.id}`, { token: other.token, body: { categoryId: secret } });
  assert.equal(edit.status, 400);

  // Before the check, the list echoed the other user's category name back.
  const list = await api('GET', '/subscriptions', { token: other.token });
  assert.ok(list.body.subscriptions.every((s) => s.categoryName !== 'Hidden hobby'));

  const badCycle = await api('PUT', `/subscriptions/${created.body.id}`, { token: other.token, body: { billingCycle: 'hourly' } });
  assert.equal(badCycle.status, 400);
});

// ---------- Pending invites ----------

test("the member list doesn't show pending invites to anyone", async () => {
  const owner = await newUser(api, 'Host');
  const member = await newUser(api, 'Housemate');
  const invitee = await newUser(api, 'Maybe');
  const household = (await api('POST', '/profiles', { token: owner.token, body: { name: 'House' } })).body.id;

  await api('POST', `/profiles/${household}/members`, { token: owner.token, body: { email: member.email } });
  await api('POST', `/profiles/invites/${household}/accept`, { token: member.token });
  const invite = await api('POST', `/profiles/${household}/members`, { token: owner.token, body: { email: invitee.email } });
  assert.equal(invite.status, 202);

  for (const viewer of [owner, member]) {
    const res = await api('GET', `/profiles/${household}/members`, { token: viewer.token });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.members.map((m) => m.user_id).sort(), [owner.id, member.id].sort());
    assert.ok(!res.text.includes(invitee.email) && !res.text.includes('Maybe'), 'nothing about the invitee leaks');
  }

  // Once accepted, they're listed like anyone else.
  await api('POST', `/profiles/invites/${household}/accept`, { token: invitee.token });
  const after = await api('GET', `/profiles/${household}/members`, { token: owner.token });
  assert.equal(after.body.members.length, 3);
});
