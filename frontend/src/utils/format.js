export function formatMoney(amount, { signed = false } = {}) {
  const sign = signed && amount > 0 ? '+' : '';
  return sign + amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}
