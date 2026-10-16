// Helpers for importing CSV files downloaded straight from a bank, plus
// the duplicate detection and auto-categorization every import shares.
//
// TD Canada Trust (EasyWeb "Download > Spreadsheet (.csv)", saved as
// accountactivity.csv) writes NO header row and five columns:
//
//   date, description, withdrawal, deposit, balance
//   10/01/2026,TIM HORTONS #1234      ,4.25,,1520.10
//   10/02/2026,PAYROLL DEP            ,,2100.00,3620.10
//
// Dates are MM/DD/YYYY, exactly one of withdrawal/deposit is filled in,
// and descriptions are padded with spaces. The parser below is tolerant on
// purpose since banks tweak exports without notice: an optional header
// row, 4-6 columns, $ signs and thousands separators, ISO dates, and
// DD/MM/YYYY when a file's dates can only be read that way.

const crypto = require('crypto');
const { isValidDate, toCents } = require('../middleware/validate');

const MAX_CENTS = toCents(21_000_000); // same ceiling as isPositiveAmount

// '' -> null (empty cell), unparseable -> NaN, otherwise a number.
// Accepts "1,234.56", "$1,234.56", "-12.00" and "(12.00)".
function parseMoney(raw) {
  let s = (raw || '').trim().replace(/[$\s]/g, '').replace(/,/g, '');
  if (s === '') return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\.\d+$/.test(s)) return NaN;
  return sign * Number(s);
}

// Returns 'YYYY-MM-DD' or null. dayFirst switches a/b/yyyy from
// month/day (TD's format) to day/month.
function parseBankDate(raw, dayFirst = false) {
  const s = (raw || '').trim();
  let y, m, d;
  let match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    [, y, m, d] = match;
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    const [, a, b, year] = match;
    y = year;
    [m, d] = dayFirst ? [b, a] : [a, b];
  } else {
    return null;
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

const APP_REQUIRED = ['date', 'type', 'amount'];

function looksLikeBankDataRow(row) {
  if (row.length < 4 || row.length > 6) return false;
  if (!parseBankDate(row[0]) && !parseBankDate(row[0], true)) return false;
  const out = parseMoney(row[2]);
  const inn = parseMoney(row[3]);
  return (out === null || !Number.isNaN(out)) && (inn === null || !Number.isNaN(inn)) && (out !== null || inn !== null);
}

// Works out which layout a parsed CSV is in, from its first row:
//   { format: 'app', header }                  - this app's own export
//   { format: 'td', hasHeader, cols }          - TD-style bank download
//   null                                       - neither
function detectFormat(rows) {
  const first = rows[0].map((h) => h.trim().toLowerCase());
  if (APP_REQUIRED.every((c) => first.includes(c))) return { format: 'app', header: first };

  if (looksLikeBankDataRow(rows[0])) {
    return { format: 'td', hasHeader: false, cols: { date: 0, description: 1, withdrawal: 2, deposit: 3 } };
  }

  // Same layout with a header row, as some banks (and people tidying the
  // file in a spreadsheet) add one.
  const find = (re) => first.findIndex((h) => re.test(h));
  const cols = {
    date: find(/date/),
    description: find(/desc|details|transaction|memo|payee|name/),
    withdrawal: find(/withdraw|debit|money out|paid out/),
    deposit: find(/deposit|credit|money in|paid in/),
  };
  if (cols.date >= 0 && cols.withdrawal >= 0 && cols.deposit >= 0) {
    return { format: 'td', hasHeader: true, cols };
  }
  return null;
}

function collapseSpaces(s) {
  return s.trim().replace(/\s+/g, ' ');
}

// Turns TD-style rows into the same record shape the app-format path
// builds. Row numbers are 1-based, matching what a spreadsheet shows.
function parseBankRows(rows, { hasHeader, cols }) {
  const start = hasHeader ? 1 : 0;
  const dataRows = rows.slice(start);

  // a/b/yyyy is month/day at TD. Only if some date can't be month/day
  // (a first part over 12) and none needs month/day, read the whole file
  // as day/month - never mix the two within one file.
  let dayFirst = false;
  let needsMonthFirst = false;
  for (const raw of dataRows) {
    const m = (raw[cols.date] || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) needsMonthFirst = true;
  }
  if (needsMonthFirst) dayFirst = false;

  const records = [];
  const errors = [];
  dataRows.forEach((raw, i) => {
    const rowNum = start + i + 1;
    if (raw.every((cell) => cell.trim() === '')) return;

    const dateStr = (raw[cols.date] || '').trim();
    const date = parseBankDate(dateStr, dayFirst);
    if (!date) { errors.push({ row: rowNum, reason: `Invalid date "${dateStr}" (expected MM/DD/YYYY)` }); return; }

    const outStr = cols.withdrawal >= 0 ? raw[cols.withdrawal] || '' : '';
    const inStr = cols.deposit >= 0 ? raw[cols.deposit] || '' : '';
    const out = parseMoney(outStr);
    const inn = parseMoney(inStr);
    if (Number.isNaN(out) || Number.isNaN(inn)) {
      errors.push({ row: rowNum, reason: `Invalid amount "${(Number.isNaN(out) ? outStr : inStr).trim()}"` });
      return;
    }
    // Deposit minus withdrawal, so a negative number in either column
    // (a reversal) still lands on the right side.
    const net = toCents(inn || 0) - toCents(out || 0);
    if (net === 0) { errors.push({ row: rowNum, reason: 'No withdrawal or deposit amount' }); return; }
    const amountCents = Math.abs(net);
    if (amountCents > MAX_CENTS) { errors.push({ row: rowNum, reason: `Invalid amount "${(net < 0 ? outStr : inStr).trim()}"` }); return; }

    const description = cols.description >= 0 ? collapseSpaces(raw[cols.description] || '').slice(0, 255) : '';
    records.push({
      rowNum,
      date,
      type: net < 0 ? 'expense' : 'income',
      description,
      amountCents,
      categoryId: null,
      recurring: false,
      interval: null,
      autoCategorize: true,
    });
  });
  return { records, errors };
}

// ---------- Duplicate detection ----------

// What two descriptions must share to count as "the same" for duplicate
// detection: case and spacing don't matter, everything else does.
function normalizeDescription(description) {
  return collapseSpaces(description).toLowerCase();
}

// Adds an importHash to each record. The hash covers profile, date, type,
// amount and normalized description, plus how many identical rows came
// before it in the same file - so two genuinely separate $4.25 coffees on
// the same day both import, while importing an overlapping file again
// (which contains both of them again) skips both.
function assignImportHashes(profileId, records) {
  const seen = new Map();
  for (const r of records) {
    const key = [profileId, r.date, r.type, r.amountCents, normalizeDescription(r.description)].join('|');
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    r.importHash = crypto.createHash('sha256').update(`${key}|${occurrence}`).digest('hex');
  }
  return records;
}

// ---------- Auto-categorization ----------

// Looser than normalizeDescription: digits and punctuation are dropped so
// "TIM HORTONS #1234" and "Tim Hortons #5678" are the same merchant.
function merchantKey(description) {
  return description.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

// Keywords for the default categories, matched as whole words/phrases
// against merchantKey(description). Order matters: the first category
// with a match wins, so "uber eats" (Food) is checked before "uber"
// (Transportation). Leaning Canadian since TD is the first bank format.
const KEYWORDS = [
  ['Salary/Income', 'income', ['payroll', 'salary', 'direct deposit', 'dir dep', 'pay dep']],
  ['Rent/Mortgage', 'expense', ['rent', 'mortgage', 'mtg']],
  ['Subscription', 'expense', ['netflix', 'spotify', 'disney plus', 'disneyplus', 'crave', 'apple com bill', 'youtube premium', 'amazon prime', 'prime video', 'patreon', 'audible']],
  ['Utilities', 'expense', ['hydro', 'enbridge', 'rogers', 'bell canada', 'bell mobility', 'telus', 'fido', 'koodo', 'virgin plus', 'freedom mobile', 'alectra', 'fortisbc', 'water bill']],
  ['Groceries', 'expense', ['loblaws', 'no frills', 'nofrills', 'sobeys', 'metro', 'safeway', 'freshco', 'food basics', 'superstore', 'farm boy', 'longos', 't t', 'whole foods', 'iga', 'save on foods', 'fortinos', 'zehrs', 'costco', 'grocery', 'walmart supercenter']],
  ['Food', 'expense', ['tim hortons', 'starbucks', 'mcdonald', 'mcdonalds', 'subway', 'a w', 'uber eats', 'ubereats', 'doordash', 'skipthedishes', 'skip the dishes', 'restaurant', 'pizza', 'cafe', 'coffee', 'wendy', 'wendys', 'burger king', 'popeyes', 'harvey', 'chipotle', 'kfc', 'dominos', 'second cup']],
  ['Transportation', 'expense', ['presto', 'uber', 'lyft', 'petro canada', 'esso', 'shell', 'husky', 'pioneer', 'ultramar', 'chevron', 'ttc', 'go transit', 'parking', 'impark', 'green p', 'translink', 'stm']],
  ['Healthcare', 'expense', ['shoppers drug mart', 'pharmacy', 'pharmasave', 'rexall', 'dental', 'dentist', 'clinic', 'physio', 'optometr']],
  ['Entertainment', 'expense', ['cineplex', 'ticketmaster', 'steam', 'playstation', 'xbox', 'nintendo', 'landmark cinemas']],
  ['Shopping', 'expense', ['amazon', 'amzn', 'best buy', 'canadian tire', 'winners', 'ikea', 'home depot', 'dollarama', 'walmart', 'hudson s bay', 'sport chek', 'indigo']],
].map(([category, type, words]) => [category, type, words.map(merchantKey)]);

function keywordCategory(description, type) {
  const padded = ` ${merchantKey(description)} `;
  for (const [category, catType, words] of KEYWORDS) {
    if (catType !== type) continue;
    if (words.some((w) => padded.includes(` ${w} `))) return category;
  }
  return null;
}

// Picks a category for a record with none, or returns null.
//   history:   Map of `${type}|${merchantKey}` -> categoryId, from this
//              profile's past categorized transactions (most recent wins)
//   byName:    Map of lower-cased category name -> id, for the categories
//              this user can see (defaults they haven't hidden + custom)
// The user's own history wins over the built-in keywords.
function guessCategory(record, { history, byName }) {
  const key = merchantKey(record.description);
  if (key) {
    const fromHistory = history.get(`${record.type}|${key}`);
    if (fromHistory) return fromHistory;
  }
  const name = keywordCategory(record.description, record.type);
  return (name && byName.get(name.toLowerCase())) || null;
}

module.exports = {
  parseMoney,
  parseBankDate,
  detectFormat,
  parseBankRows,
  normalizeDescription,
  assignImportHashes,
  merchantKey,
  keywordCategory,
  guessCategory,
};
