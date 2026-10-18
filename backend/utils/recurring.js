// Spots recurring charges and deposits in imported bank rows: the same
// merchant, for about the same amount, at a steady weekly, monthly or
// yearly rhythm. A bank file carries no "recurring" flag of its own, and
// one monthly download holds only one copy of a monthly bill, so the
// import route feeds in this profile's earlier transactions as well.

const DAY_MS = 86_400_000;

// What must match for two rows to be the same charge again. Stricter than
// merchantKey: digits stay (the account in "SSV TO: 11926353111", the
// masked e-transfer recipient in "***Du6"), so separate transfers to
// different people never merge into one "series". Store numbers ("#1234")
// and TD's card marker ("_V") go, since they vary for the same merchant.
function seriesKey(description) {
  return description
    .toLowerCase()
    .replace(/_[a-z]\s*$/, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^a-z0-9*]+/g, ' ')
    .trim();
}

// gap: allowed days between one occurrence and the next.
// minCount: occurrences needed before calling it a pattern. Two weekly
//   charges a week apart happen by chance all the time; two identical
//   monthly charges a month apart rarely do, and a yearly one only ever
//   shows up twice in a year of history.
const INTERVALS = [
  { name: 'weekly', gap: [6, 8], minCount: 3 },
  { name: 'monthly', gap: [27, 34], minCount: 2 },
  { name: 'yearly', gap: [355, 375], minCount: 2 },
];

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// points: [{ date: 'YYYY-MM-DD', amountCents }] for one series key.
// Returns 'weekly' | 'monthly' | 'yearly' | null.
//
// Every gap must fit the interval: one stray extra purchase breaks the
// pattern, which is what keeps a coffee shop you visit most weeks from
// being called a weekly subscription. Amounts must stay close - a bill
// that drifts a little month to month still counts (25%), but with only
// two occurrences the amounts must match almost exactly (5%), since that
// is all the evidence there is.
function detectInterval(points) {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const days = sorted.map((p) => Date.parse(`${p.date}T00:00:00Z`) / DAY_MS);
  const gaps = days.slice(1).map((d, i) => d - days[i]);

  const mid = median(sorted.map((p) => p.amountCents));
  const tolerance = sorted.length === 2 ? 0.05 : 0.25;
  if (!sorted.every((p) => Math.abs(p.amountCents - mid) <= mid * tolerance)) return null;

  for (const { name, gap: [lo, hi], minCount } of INTERVALS) {
    if (sorted.length < minCount) continue;
    if (gaps.every((g) => g >= lo && g <= hi)) return name;
  }
  return null;
}

// rows: every candidate row, new and already stored, each with
//   { type, description, date, amountCents }
// Returns Map `${type}|${seriesKey}` -> interval, for each series that
// recurs. Income and spending never share a series.
function findRecurringSeries(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.type}|${seriesKey(r.description)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const found = new Map();
  for (const [key, points] of groups) {
    const interval = detectInterval(points);
    if (interval) found.set(key, interval);
  }
  return found;
}

module.exports = { seriesKey, detectInterval, findRecurringSeries };
