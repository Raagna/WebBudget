import { formatMoney } from '../utils/format.js';

// A signed amount with its direction in the colour: green for up, red
// only for down (red always means "less than before" in this app).
export default function Delta({ value, currency, suffix = '' }) {
  if (value === null || value === undefined) return <span className="delta">—</span>;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : '';
  return <span className={`delta ${dir}`}>{formatMoney(value, { signed: true, currency })}{suffix}</span>;
}
