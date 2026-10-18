const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');
const { parseCsv } = require('../utils/csv');
const { detectFormat, parseBankRows, parseMoney, parseBankDate, keywordCategory } = require('../utils/bankImport');

let env;
let api;
before(async () => {
  env = await start('bank_import');
  api = client(env.origin);
});
after(() => env.stop());

// The shape of a TD EasyWeb accountactivity.csv: no header row; date
// (MM/DD/YYYY), padded description, withdrawal, deposit, running balance.
const TD_WEEK_1 = [
  '10/01/2026,TIM HORTONS #1234        ,4.25,,1520.10',
  '10/01/2026,TIM HORTONS #1234        ,4.25,,1515.85', // a second, separate coffee
  '10/02/2026,PAYROLL DEP              ,,"2,100.00",3615.85',
  '10/03/2026,"LOBLAWS, TORONTO"       ,82.17,,3533.68',
  '10/04/2026,JOES CORNER STORE #12    ,15.00,,3518.68',
].join('\r\n');

// The next download overlaps the first by two days.
const TD_WEEK_2 = [
  '10/03/2026,"LOBLAWS, TORONTO"       ,82.17,,3533.68',
  '10/04/2026,JOES CORNER STORE #12    ,15.00,,3518.68',
  '10/05/2026,NETFLIX.COM              ,16.49,,3502.19',
  '10/06/2026,E-TRANSFER RENT          ,1800.00,,1702.19',
].join('\r\n');

async function categoryIds(token) {
  const res = await api('GET', '/categories', { token });
  return new Map(res.body.categories.map((c) => [c.name, c.id]));
}

async function list(u) {
  const res = await api('GET', `/transactions?profileId=${u.profileId}&sort=occurred_on&dir=asc`, { token: u.token });
  return res.body.transactions;
}

function importCsv(u, csv) {
  return api('POST', '/transactions/import', { token: u.token, body: { profileId: u.profileId, csv } });
}

test('parses the TD EasyWeb layout: no header, withdrawals as expenses, deposits as income', () => {
  const rows = parseCsv(TD_WEEK_1);
  const detected = detectFormat(rows);
  assert.equal(detected.format, 'td');
  assert.equal(detected.hasHeader, false);

  const { records, errors } = parseBankRows(rows, detected);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 5);
  assert.deepEqual(
    records.map(({ rowNum, date, type, description, amountCents }) => ({ rowNum, date, type, description, amountCents })),
    [
      { rowNum: 1, date: '2026-10-01', type: 'expense', description: 'TIM HORTONS #1234', amountCents: 425 },
      { rowNum: 2, date: '2026-10-01', type: 'expense', description: 'TIM HORTONS #1234', amountCents: 425 },
      { rowNum: 3, date: '2026-10-02', type: 'income', description: 'PAYROLL DEP', amountCents: 210000 },
      { rowNum: 4, date: '2026-10-03', type: 'expense', description: 'LOBLAWS, TORONTO', amountCents: 8217 },
      { rowNum: 5, date: '2026-10-04', type: 'expense', description: 'JOES CORNER STORE #12', amountCents: 1500 },
    ]
  );
});

test('the TD parser tolerates headers, BOM-free ISO dates, $ signs, missing balance and bad rows', () => {
  const rows = parseCsv([
    'Date,Description,Withdrawals,Deposits,Balance',
    '2026-10-01,Coffee,$4.25,,',
    '10/02/2026,Refund,,(3.00),', // negative deposit = money out
    '13/40/2026,Bad date,1.00,,',
    '10/03/2026,No amount,,,',
    '10/04/2026,Bad amount,abc,,',
    '10/05/2026,Four columns,7.00,',
  ].join('\n'));
  const detected = detectFormat(rows);
  assert.equal(detected.format, 'td');
  assert.equal(detected.hasHeader, true);
  const { records, errors } = parseBankRows(rows, detected);
  assert.deepEqual(records.map((r) => [r.rowNum, r.date, r.type, r.amountCents]), [
    [2, '2026-10-01', 'expense', 425],
    [3, '2026-10-02', 'expense', 300],
    [7, '2026-10-05', 'expense', 700],
  ]);
  assert.deepEqual(errors.map((e) => e.row), [4, 5, 6]);

  assert.equal(parseMoney('1,234.56'), 1234.56);
  assert.equal(parseMoney(''), null);
  assert.ok(Number.isNaN(parseMoney('12.3.4')));
  assert.equal(parseBankDate('02/03/2026'), '2026-02-03'); // month first, like TD
  assert.equal(parseBankDate('02/03/2026', true), '2026-03-02');
  assert.equal(parseBankDate('02/30/2026'), null);
});

test('a file whose dates only make sense day-first is read day-first throughout', () => {
  const rows = parseCsv('25/09/2026,A,1.00,,\n02/10/2026,B,2.00,,');
  const { records } = parseBankRows(rows, detectFormat(rows));
  assert.deepEqual(records.map((r) => r.date), ['2026-09-25', '2026-10-02']);
});

test('a TD download imports directly through the API', async () => {
  const u = await newUser(api, 'TdImporter');
  const res = await importCsv(u, TD_WEEK_1);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.format, 'td');
  assert.equal(res.body.imported, 5);
  assert.equal(res.body.duplicates, 0);
  assert.equal(res.body.totalRows, 5);

  const rows = await list(u);
  assert.deepEqual(rows.map((t) => [t.date, t.type, t.amount, t.description]), [
    ['2026-10-01', 'expense', 4.25, 'TIM HORTONS #1234'],
    ['2026-10-01', 'expense', 4.25, 'TIM HORTONS #1234'],
    ['2026-10-02', 'income', 2100, 'PAYROLL DEP'],
    ['2026-10-03', 'expense', 82.17, 'LOBLAWS, TORONTO'],
    ['2026-10-04', 'expense', 15, 'JOES CORNER STORE #12'],
  ]);
});

test('re-importing an overlapping download skips the rows already imported', async () => {
  const u = await newUser(api, 'Overlap');
  assert.equal((await importCsv(u, TD_WEEK_1)).body.imported, 5);

  const again = await importCsv(u, TD_WEEK_1);
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.imported, 0);
  // Both same-day coffees count as already imported - neither is dropped
  // the first time, and neither comes back the second time.
  assert.equal(again.body.duplicates, 5);
  assert.deepEqual(again.body.duplicateRows, [1, 2, 3, 4, 5]);

  const next = await importCsv(u, TD_WEEK_2);
  assert.equal(next.body.imported, 2);
  assert.equal(next.body.duplicates, 2);
  assert.deepEqual(next.body.duplicateRows, [1, 2]);
  assert.equal((await list(u)).length, 7);

  // Whitespace and case differences in the description still match.
  const r2 = await importCsv(u, '"10/03/2026","Loblaws,  TORONTO",82.17,,0');
  assert.equal(r2.body.duplicates, 1);
  assert.equal(r2.body.imported, 0);
});

test('duplicate detection is per profile', async () => {
  const a = await newUser(api, 'ProfileA');
  const b = await newUser(api, 'ProfileB');
  assert.equal((await importCsv(a, TD_WEEK_2)).body.imported, 4);
  assert.equal((await importCsv(b, TD_WEEK_2)).body.imported, 4);
});

test('re-importing the same app-format file skips duplicates too', async () => {
  const u = await newUser(api, 'AppFormat');
  const csv = 'date,type,description,category,amount\n2026-10-01,expense,Lunch,Food,12.50\n2026-10-02,income,Pay,,100';
  assert.equal((await importCsv(u, csv)).body.imported, 2);
  const again = await importCsv(u, csv);
  assert.equal(again.body.format, 'app');
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.duplicates, 2);
  // App-format rows keep exactly the category the file gives (none here).
  assert.equal((await list(u)).find((t) => t.description === 'Pay').categoryId, null);
});

test('bank rows are auto-categorized from past transactions first, then keywords', async () => {
  const u = await newUser(api, 'Categorizer');
  const cats = await categoryIds(u.token);

  // History: this profile filed the corner store under Groceries before
  // (store number differs) and coffee at Tim Hortons under Entertainment,
  // which must beat the built-in "tim hortons" -> Food keyword.
  await addTransaction(api, u.token, u.profileId, { description: 'Joes Corner Store #7', categoryId: cats.get('Groceries'), date: '2026-09-01' });
  await addTransaction(api, u.token, u.profileId, { description: 'Tim Hortons #99', categoryId: cats.get('Food'), date: '2026-08-01' });
  await addTransaction(api, u.token, u.profileId, { description: 'TIM HORTONS #5', categoryId: cats.get('Entertainment'), date: '2026-09-15' });

  const res = await importCsv(u, `${TD_WEEK_1}\r\n${TD_WEEK_2.split('\r\n').slice(2).join('\r\n')}\r\n10/07/2026,MYSTERY VENDOR,9.99,,0`);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 8);
  assert.equal(res.body.autoCategorized, 7);

  const byDesc = new Map();
  for (const t of await list(u)) if (t.date >= '2026-10-01') byDesc.set(t.description, t.categoryName);
  assert.equal(byDesc.get('TIM HORTONS #1234'), 'Entertainment'); // newest history wins
  assert.equal(byDesc.get('JOES CORNER STORE #12'), 'Groceries'); // from history
  assert.equal(byDesc.get('PAYROLL DEP'), 'Salary/Income'); // keyword
  assert.equal(byDesc.get('LOBLAWS, TORONTO'), 'Groceries'); // keyword
  assert.equal(byDesc.get('NETFLIX.COM'), 'Subscription'); // keyword
  assert.equal(byDesc.get('E-TRANSFER RENT'), 'Rent/Mortgage'); // keyword
  assert.equal(byDesc.get('MYSTERY VENDOR'), null);
});

test('keywords match whole words and respect income vs expense', () => {
  assert.equal(keywordCategory('UBER EATS TORONTO', 'expense'), 'Food');
  assert.equal(keywordCategory('UBER TRIP 1234', 'expense'), 'Transportation');
  assert.equal(keywordCategory('CURRENT ACCOUNT FEE', 'expense'), 'Bank Fees'); // not "rent"
  assert.equal(keywordCategory('PAYROLL DEP', 'expense'), null);
  assert.equal(keywordCategory('PAYROLL DEP', 'income'), 'Salary/Income');
});

test('auto-categorization skips categories the user has hidden', async () => {
  const u = await newUser(api, 'Hider');
  const cats = await categoryIds(u.token);
  const del = await api('DELETE', `/categories/${cats.get('Groceries')}`, { token: u.token });
  assert.ok(del.status < 300, del.text);
  const res = await importCsv(u, '10/03/2026,LOBLAWS,82.17,,0');
  assert.equal(res.body.autoCategorized, 0);
});

test('an unrecognized file is rejected with a helpful message', async () => {
  const u = await newUser(api, 'Unknown');
  const res = await importCsv(u, 'foo,bar\n1,2');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /TD bank download/);
});
