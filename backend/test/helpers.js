// Shared setup for the API tests (run with `npm test`, Node's built-in
// test runner - no extra dependencies).
//
// Each test file gets its own throwaway Postgres SCHEMA inside the dev
// database, so tests never touch real data, need no extra database (or
// CREATEDB rights), and can run in parallel. The schema is created fresh,
// migrated, and dropped again afterwards.
//
// Uses TEST_DATABASE_URL if set, otherwise DATABASE_URL from backend/.env.
const path = require('path');
const { randomUUID } = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!BASE_URL) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL (backend/.env) to run the tests');

function withSearchPath(url, schema) {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema}`);
  return u.toString();
}

// Must run before anything requires ../db or ../app, which read these
// env vars when they load.
function configure(name) {
  const schema = `test_${name.replace(/\W/g, '_')}_${process.pid}`;
  process.env.DATABASE_URL = withSearchPath(BASE_URL, schema);
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  // Every request in the tests comes from 127.0.0.1, which would trip the
  // 20-per-15-minutes auth rate limit. Trusting one proxy hop lets each
  // request carry its own client IP in X-Forwarded-For (see api() below).
  process.env.TRUST_PROXY = '1';
  delete process.env.RENDER;
  return schema;
}

async function start(name) {
  const schema = configure(name);
  const { Client } = require('pg');
  const admin = new Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schema}`);

  const db = require('../db');
  await db.runMigrations();
  const app = require('../app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await db.pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }

  return { origin, db, stop };
}

let ipCounter = 0;

// Small fetch wrapper. Each call gets a distinct fake client IP unless one
// is given, so rate limits only bite in tests that ask for them.
function client(origin) {
  return async function api(method, url, { token, body, ip, raw } = {}) {
    const headers = { 'X-Forwarded-For': ip || `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const t0 = performance.now();
    const res = await fetch(origin + '/api' + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ms = performance.now() - t0;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON (e.g. CSV export) */ }
    return { status: res.status, body: raw ? text : json, text, ms };
  };
}

// Registers a fresh user and returns their token, id and first profile id.
async function newUser(api, name = 'User') {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
  const password = 'Password123!';
  const reg = await api('POST', '/auth/register', { body: { name, email, password } });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
  const profiles = await api('GET', '/profiles', { token: reg.body.token });
  return { token: reg.body.token, id: reg.body.user.id, email, password, profileId: profiles.body.profiles[0].id };
}

async function addTransaction(api, token, profileId, fields = {}) {
  const res = await api('POST', '/transactions', {
    token,
    body: { profileId, amount: 10, type: 'expense', description: 'Test', date: '2026-10-01', ...fields },
  });
  if (res.status !== 201) throw new Error(`add transaction failed: ${res.status} ${res.text}`);
  return res.body;
}

module.exports = { start, client, newUser, addTransaction };
