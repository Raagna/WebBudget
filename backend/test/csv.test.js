const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');
const { parseCsv } = require('../utils/csv');

let env;
let api;
before(async () => {
  env = await start('csv');
  api = client(env.origin);
});
after(() => env.stop());

async function count(profileId) {
  const rows = await env.db.query('SELECT COUNT(*)::int AS n FROM transactions WHERE profile_id = ?', [profileId]);
  return rows[0].n;
}

test('impossible dates and too-large amounts are reported per row instead of failing the import', async () => {
  const u = await newUser(api, 'Importer');
  const csv = [
    'date,type,description,amount',
    '2026-10-01,expense,Valid row,12.50',
    '2024-02-31,expense,February 31st,5.00', // used to roll over to March 2 and then 500
    '2026-10-02,expense,Too big,99999999.00', // used to overflow INTEGER cents and 500
    '2026-10-03,income,Another valid row,100',
  ].join('\n');
  const res = await api('POST', '/transactions/import', { token: u.token, body: { profileId: u.profileId, csv } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 2);
  assert.deepEqual(res.body.errors.map((e) => e.row), [3, 4]);
  assert.equal(await count(u.profileId), 2);
});

test('an import that fails partway saves nothing, so retrying cannot create duplicates', async () => {
  const u = await newUser(api, 'Atomic');
  // Force the database to reject one specific row. This trigger only
  // exists inside this test's throwaway schema.
  await env.db.run(`
    CREATE OR REPLACE FUNCTION reject_boom() RETURNS trigger AS $$
    BEGIN
      IF NEW.description = 'BOOM' THEN RAISE EXCEPTION 'simulated failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await env.db.run('CREATE TRIGGER reject_boom BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION reject_boom()');
  try {
    const csv = 'date,type,description,amount\n2026-10-01,expense,First,1\n2026-10-02,expense,BOOM,2\n2026-10-03,expense,Third,3';
    const res = await api('POST', '/transactions/import', { token: u.token, body: { profileId: u.profileId, csv } });
    assert.equal(res.status, 500);
    // Before the fix, "First" was already saved when "BOOM" failed.
    assert.equal(await count(u.profileId), 0);
  } finally {
    await env.db.run('DROP TRIGGER reject_boom ON transactions');
  }
});

test('export neutralizes spreadsheet formulas, and re-import restores the original text', async () => {
  const u = await newUser(api, 'Exporter');
  const dangerous = ['=HYPERLINK("http://evil.example","click")', '+1+1', '-2+3', '@SUM(A1:A2)'];
  for (const description of dangerous) await addTransaction(api, u.token, u.profileId, { description, amount: 7.25 });
  await addTransaction(api, u.token, u.profileId, { description: 'Normal coffee', amount: 3.5 });

  const exp = await api('GET', `/transactions/export?profileId=${u.profileId}`, { token: u.token, raw: true });
  assert.equal(exp.status, 200);
  const [header, ...rows] = parseCsv(exp.body);
  const col = (name) => header.indexOf(name);
  for (const row of rows) {
    assert.ok(!/^[=+\-@]/.test(row[col('description')]), `cell would run as a formula: ${row[col('description')]}`);
  }
  assert.ok(rows.every((r) => /^\d+(\.\d+)?$/.test(r[col('amount')])), 'amounts stay plain numbers');
  assert.ok(rows.some((r) => r[col('description')] === 'Normal coffee'), 'ordinary text is untouched');

  // Round trip into a second profile: descriptions come back unchanged.
  const other = await newUser(api, 'Reimporter');
  const imp = await api('POST', '/transactions/import', { token: other.token, body: { profileId: other.profileId, csv: exp.body } });
  assert.equal(imp.status, 200, imp.text);
  const list = await api('GET', `/transactions?profileId=${other.profileId}`, { token: other.token });
  assert.deepEqual(list.body.transactions.map((t) => t.description).sort(), [...dangerous, 'Normal coffee'].sort());
});
