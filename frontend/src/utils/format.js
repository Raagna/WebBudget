export function formatMoney(amount, { signed = false, currency = 'USD' } = {}) {
  const sign = signed && amount > 0 ? '+' : '';
  // Intl handles each currency's correct number of decimal places on its
  // own (e.g. 0 for JPY, 2 for USD/EUR) - no special-casing needed here.
  // A real minus sign (U+2212), not Intl's hyphen, so negatives match the
  // "−" used in sums and lists and line up with the digits.
  return sign + amount.toLocaleString('en-US', { style: 'currency', currency }).replace(/^-/, '−');
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

// "just now", "5 min ago", "3 h ago", "2 d ago", then a date.
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function currentYearMonth() {
  return localToday().slice(0, 7);
}
