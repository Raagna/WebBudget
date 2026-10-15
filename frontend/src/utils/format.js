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

// Today's date in the user's own timezone as YYYY-MM-DD. toISOString()
// would give the UTC date, which is already "tomorrow" on a US evening -
// enough to show a bill due today as overdue.
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whole days from `fromIso` to `toIso` (both YYYY-MM-DD); negative when
// `toIso` is earlier.
export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000);
}

export function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}
