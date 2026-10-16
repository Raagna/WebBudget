const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('auth_security');
  api = client(env.origin);
});
after(() => env.stop());

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

test('login takes as long for an unknown email as for a wrong password', async () => {
  const u = await newUser(api, 'Timing');
  const unknown = [];
  const wrong = [];
  for (let i = 0; i < 5; i++) {
    const a = await api('POST', '/auth/login', { body: { email: `nobody-${i}@example.test`, password: 'whatever123' } });
    const b = await api('POST', '/auth/login', { body: { email: u.email, password: 'whatever123' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    unknown.push(a.ms);
    wrong.push(b.ms);
  }
  // Both paths now do one full bcrypt comparison (~100-300ms at cost 12).
  // Before the fix the unknown-email path skipped it and answered in a few
  // milliseconds, so this ratio was close to 0.
  const ratio = median(unknown) / median(wrong);
  assert.ok(ratio > 0.6, `unknown-email login took ${median(unknown).toFixed(0)}ms vs ${median(wrong).toFixed(0)}ms for a wrong password`);
});

test('the login rate limit is per client IP behind a proxy, not shared by everyone', async () => {
  const attacker = '203.0.113.7';
  const someoneElse = '198.51.100.20';
  const body = { email: 'target@example.test', password: 'guess-guess' };

  let last;
  for (let i = 0; i < 21; i++) last = await api('POST', '/auth/login', { body, ip: attacker });
  assert.equal(last.status, 429, 'the 21st attempt from one IP should be rate limited');

  // With trust proxy unset, req.ip was the proxy's address for every user,
  // so this request would have been blocked too.
  const other = await api('POST', '/auth/login', { body, ip: someoneElse });
  assert.equal(other.status, 401, 'a different client must not be locked out by the attacker');
});
