export function formatMoney(amount, { signed = false, currency = 'USD' } = {}) {
  const sign = signed && amount > 0 ? '+' : '';
  // Intl handles each currency's correct number of decimal places on its
  // own (e.g. 0 for JPY, 2 for USD/EUR) - no special-casing needed here.
  return sign + amount.toLocaleString('en-US', { style: 'currency', currency });
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Today's date as YYYY-MM-DD in the user's own timezone. Don't use
// toISOString() for this: it gives the UTC date, which is already
// tomorrow in the evening across the Americas. Call it when the value is
// needed, not once at module load, so a tab left open past midnight
// doesn't keep yesterday's date.
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Whole days from `fromIso` to `toIso` (both YYYY-MM-DD); negative when
// `toIso` is earlier.
export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000);
}

export function currentYearMonth() {
  return localToday().slice(0, 7);
}
