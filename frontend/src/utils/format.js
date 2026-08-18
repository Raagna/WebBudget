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

export function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}
