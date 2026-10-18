// Auto-filling bank imports: categories from bank codes and the local
// model, and the recurring flag from weekly/monthly/yearly patterns.
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser, addTransaction } = require('./helpers');
const { keywordCategory, merchantKey } = require('../utils/bankImport');
const { detectInterval, seriesKey } = require('../utils/recurring');

let env;
let api;
before(async () => {
  env = await start('smart_import');
  api = client(env.origin);
});
after(() => env.stop());

function importCsv(u, lines) {
  return api('POST', '/transactions/import', { token: u.token, body: { profileId: u.profileId, csv: lines.join('\r\n') } });
}

async function list(u) {
  const res = await api('GET', `/transactions?profileId=${u.profileId}&sort=occurred_on&dir=asc&limit=500`, { token: u.token });
  return res.body.transactions;
}

const pts = (...rows) => rows.map(([date, amountCents]) => ({ date, amountCents }));

test('bank codes from a real TD file land in a category', () => {
  assert.equal(keywordCategory('SEND E-TFR ***Du6', 'expense'), 'Transfers');
  assert.equal(keywordCategory('E-TRANSFER ***3cJ', 'income'), 'Transfers');
  assert.equal(keywordCategory('SSV TO: 11926353111', 'expense'), 'Transfers');
  assert.equal(keywordCategory('JO461 TFR-FR 6353111', 'income'), 'Transfers');
  assert.equal(keywordCategory('NSF RETURN FEE', 'expense'), 'Bank Fees');
  assert.equal(keywordCategory('AGF MTF', 'expense'), 'Investments');
  assert.equal(keywordCategory('PRES/SRQ9RL95RW _T', 'expense'), 'Transportation');
  assert.equal(keywordCategory('STUDENT LOAN GSL', 'income'), 'Other');
  // Merchant keywords still come first: a memo'd e-transfer is rent.
  assert.equal(keywordCategory('E-TRANSFER RENT', 'expense'), 'Rent/Mortgage');
  // A masked reference is noise, not a keyword ("***stm" is not the STM).
  assert.equal(merchantKey('SEND E-TFR ***stm'), 'send e tfr');
  assert.equal(merchantKey('AMAZON _V'), 'amazon');
  assert.equal(merchantKey('GIGSKY INC 2.70_V'), 'gigsky inc');
});

test('weekly, monthly and yearly rhythms are recognized; irregular ones are not', () => {
  assert.equal(detectInterval(pts(['2026-09-14', 5000], ['2026-10-14', 5000])), 'monthly');
  assert.equal(detectInterval(pts(['2026-08-01', 8412], ['2026-09-02', 9100], ['2026-10-01', 7800])), 'monthly'); // a bill that drifts
  assert.equal(detectInterval(pts(['2026-09-01', 1200], ['2026-09-08', 1200], ['2026-09-15', 1250])), 'weekly');
  assert.equal(detectInterval(pts(['2025-10-10', 9900], ['2026-10-10', 9900])), 'yearly');

  assert.equal(detectInterval(pts(['2026-09-01', 1200], ['2026-09-08', 1200])), null); // two weeks is chance
  assert.equal(detectInterval(pts(['2026-09-14', 5000], ['2026-10-14', 6000])), null); // two different amounts
  assert.equal(detectInterval(pts(['2026-09-01', 425], ['2026-09-08', 425], ['2026-09-11', 425])), null); // a stray visit
  assert.equal(detectInterval(pts(['2026-10-01', 425], ['2026-10-01', 425], ['2026-10-31', 425])), null); // two the same day

  // Store numbers and card markers don't split a series; the account a
  // transfer goes to does.
  assert.equal(seriesKey('NETFLIX.COM #12 _V'), seriesKey('NETFLIX.COM #9'));
  assert.notEqual(seriesKey('SSV TO: 111'), seriesKey('SSV TO: 222'));
});

test('a monthly charge is flagged across two imports, earlier row included', async () => {
  const u = await newUser(api, 'Monthly');
  const first = await importCsv(u, ['09/14/2026,AGF MTF,50.00,,100']);
  assert.equal(first.body.recurring, 0); // one occurrence proves nothing

  const second = await importCsv(u, ['10/14/2026,AGF MTF,50.00,,50', '10/15/2026,NSF RETURN FEE,10.00,,40']);
  assert.equal(second.status, 200, second.text);
  assert.equal(second.body.recurring, 1);
  assert.equal(second.body.recurringExisting, 1);

  const rows = await list(u);
  const agf = rows.filter((t) => t.description === 'AGF MTF');
  assert.deepEqual(agf.map((t) => [t.isRecurring, t.recurringInterval, t.categoryName]), [
    [true, 'monthly', 'Investments'],
    [true, 'monthly', 'Investments'],
  ]);
  const fee = rows.find((t) => t.description === 'NSF RETURN FEE');
  assert.equal(fee.isRecurring, false);
  assert.equal(fee.categoryName, 'Bank Fees');
});

test('a weekly series in one file is flagged; a regular café is not', async () => {
  const u = await newUser(api, 'Weekly');
  const res = await importCsv(u, [
    '09/01/2026,GOODLIFE FITNESS,12.00,,0',
    '09/08/2026,GOODLIFE FITNESS,12.00,,0',
    '09/15/2026,GOODLIFE FITNESS,12.00,,0',
    '09/22/2026,GOODLIFE FITNESS,12.00,,0',
    '09/02/2026,TIM HORTONS #17 _M,4.25,,0',
    '09/09/2026,TIM HORTONS #17 _M,4.25,,0',
    '09/12/2026,TIM HORTONS #17 _M,4.25,,0',
  ]);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.recurring, 4);
  const rows = await list(u);
  assert.ok(rows.filter((t) => t.description === 'GOODLIFE FITNESS').every((t) => t.recurringInterval === 'weekly'));
  assert.ok(rows.filter((t) => t.description.startsWith('TIM')).every((t) => !t.isRecurring));
});

test('a row the user already marked recurring keeps its interval', async () => {
  const u = await newUser(api, 'Keeper');
  await addTransaction(api, u.token, u.profileId, {
    description: 'SPOTIFY', amount: 11.99, date: '2026-09-05', isRecurring: true, recurringInterval: 'yearly',
  });
  const res = await importCsv(u, ['10/05/2026,SPOTIFY,11.99,,0']);
  assert.equal(res.body.recurring, 1);
  assert.equal(res.body.recurringExisting, 0);
  const rows = await list(u);
  assert.deepEqual(rows.map((t) => t.recurringInterval), ['yearly', 'monthly']);
});

test('importing a file again fills in categories its earlier rows were missing', async () => {
  const u = await newUser(api, 'Refill');
  const file = ['10/13/2026,UNTOUCHABLES SP _M,6.78,,0', '10/14/2026,LOBLAWS,20.00,,0'];
  const first = await importCsv(u, file);
  assert.equal(first.body.autoCategorized, 1);

  // The user files that shop under Shopping by hand once...
  const cats = new Map((await api('GET', '/categories', { token: u.token })).body.categories.map((c) => [c.name, c.id]));
  await addTransaction(api, u.token, u.profileId, { description: 'Untouchables Sp', categoryId: cats.get('Shopping'), date: '2026-10-16' });

  // ...and re-importing the same download picks that up for the old row.
  const again = await importCsv(u, file);
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.duplicates, 2);
  assert.equal(again.body.categorizedExisting, 1);
  const row = (await list(u)).find((t) => t.description === 'UNTOUCHABLES SP _M');
  assert.equal(row.categoryName, 'Shopping');
});

// A stand-in for Ollama's /api/chat that answers from a fixed table, and
// records what it was asked.
function fakeOllama(answersByDescription) {
  const asked = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const prompt = JSON.parse(body).messages[0].content;
      const lines = [...prompt.matchAll(/^(\d+)\. \[(?:income|spending)\] (.+)$/gm)];
      asked.push(...lines.map((m) => m[2]));
      const answers = lines.map((m) => {
        const category = answersByDescription[m[2]] || 'Unknown';
        return { line: Number(m[1]), recognized: category !== 'Unknown', category };
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: { content: JSON.stringify({ answers }) } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    asked,
    close: () => new Promise((r) => server.close(r)),
  })));
}

test('merchants nothing else recognizes are looked up with the local model', async (t) => {
  const model = await fakeOllama({
    'ZENDATA ESIM 2.70_V': 'Utilities',
    'UNTOUCHABLES SP _M': 'Food',
    'MYSTERY PAYER': 'Groceries', // income can't be Groceries: dropped
  });
  process.env.IMPORT_MODEL_LOOKUP = 'on';
  process.env.OLLAMA_URL = model.url;
  t.after(async () => { process.env.IMPORT_MODEL_LOOKUP = 'off'; await model.close(); });

  const u = await newUser(api, 'Lookup');
  const res = await importCsv(u, [
    '09/18/2026,ZENDATA ESIM 2.70_V,2.70,,0',
    '10/13/2026,UNTOUCHABLES SP _M,6.78,,0',
    '10/14/2026,UNTOUCHABLES SP _M,5.10,,0',
    '10/15/2026,MYSTERY PAYER,,40.00,0',
    '10/16/2026,NETFLIX.COM,16.49,,0', // a keyword: never sent to the model
  ]);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.autoCategorized, 4);
  assert.equal(res.body.lookedUp, 3);
  // One question per merchant, and only for the ones still unplaced.
  assert.deepEqual(model.asked.sort(), ['MYSTERY PAYER', 'UNTOUCHABLES SP _M', 'ZENDATA ESIM 2.70_V']);

  const byDesc = new Map((await list(u)).map((r) => [r.description, r.categoryName]));
  assert.equal(byDesc.get('ZENDATA ESIM 2.70_V'), 'Utilities');
  assert.equal(byDesc.get('UNTOUCHABLES SP _M'), 'Food');
  assert.equal(byDesc.get('MYSTERY PAYER'), null);
});

test('an import still works when the model is not running', async (t) => {
  process.env.IMPORT_MODEL_LOOKUP = 'on';
  process.env.OLLAMA_URL = 'http://127.0.0.1:9'; // nothing listens here
  t.after(() => { process.env.IMPORT_MODEL_LOOKUP = 'off'; });

  const u = await newUser(api, 'NoModel');
  const res = await importCsv(u, ['10/13/2026,UNTOUCHABLES SP _M,6.78,,0', '10/14/2026,LOBLAWS,20.00,,0']);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.imported, 2);
  assert.equal(res.body.autoCategorized, 1);
  assert.equal(res.body.lookedUp, 0);
});
