// Words for the payoff plan: months as dates and spans of time.

// '2029-03' -> 'March 2029'
export function monthName(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// '2029-03' -> 'Mar 2029', for chart axes and tight lists.
export function monthShort(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// 29 -> '2 years 5 months', 12 -> '1 year', 1 -> '1 month'.
export function duration(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (y === 0) return part(m, 'month');
  if (m === 0) return part(y, 'year');
  return `${part(y, 'year')} ${part(m, 'month')}`;
}

// '2026-10' plus 3 -> '2027-01' (same as the backend's addMonths).
export function addMonths(yyyyMm, n) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

// The three plans' balances as chart rows, one per month from today:
// { month, avalanche, snowball, minimum }. A plan that has finished
// stays at zero to the end; one that never finishes just stops.
export function chartRows(thisMonth, plans) {
  const keys = Object.keys(plans);
  const length = Math.max(...keys.map((k) => plans[k].balances.length));
  return Array.from({ length }, (_, i) => {
    const row = { month: addMonths(thisMonth, i) };
    for (const k of keys) {
      const b = plans[k].balances;
      row[k] = i < b.length ? b[i] : plans[k].paidOff ? 0 : undefined;
    }
    return row;
  });
}
