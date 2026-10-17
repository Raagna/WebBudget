import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, Legend, ReferenceLine } from 'recharts';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, localToday } from '../utils/format.js';

const AXIS = { fontSize: 12, fill: '#4f5b55' };
const GRID = '#e3e8e3';
const TOOLTIP_STYLE = { fontSize: 13, borderRadius: 10, borderColor: '#d7ded7', boxShadow: '0 8px 20px -12px rgba(23,33,29,.35)' };

// Round axis ticks that always include zero: 0, −1K, −2K rather than the
// odd values a chart library picks for a tight range.
function roundTicks(min, max) {
  const range = max - min || 1;
  const rough = range / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= rough) * mag;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

export default function Reports() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [months, setMonths] = useState(12);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    client.get('/dashboard/trends', { params: { profileId: activeProfileId, months, today: localToday() } })
      .then((res) => { if (!cancelled) setTrends(res.data.trends); })
      .catch(() => { if (!cancelled) setError('Could not load your reports right now.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeProfileId, months]);

  const totalIncome = trends.reduce((s, t) => s + (t.income || 0), 0);
  const totalExpenses = trends.reduce((s, t) => s + (t.expenses || 0), 0);
  const avgMonthlyNet = trends.length ? (totalIncome - totalExpenses) / trends.length : 0;
  const currency = activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  // Short month names; add the year once the range spans more than one.
  const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, months > 12 ? { month: 'short', year: '2-digit' } : { month: 'short' });
  const net = trends.map((t) => ({ month: t.month, net: (t.income || 0) - (t.expenses || 0) }));
  const netTicks = roundTicks(Math.min(0, ...net.map((n) => n.net)), Math.max(0, ...net.map((n) => n.net)));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <div className="subtitle">{activeProfile ? `${activeProfile.name} · income and spending over time` : 'Income and spending over time'}</div>
        </div>
        <div className="form-field" style={{ minWidth: 170 }}>
          <label htmlFor="report-range">Period</label>
          <select id="report-range" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <p className="budget-summary">
        <span><b style={{ color: 'var(--positive)' }}>{money(totalIncome)}</b>came in</span>
        <span><b>{money(totalExpenses)}</b>went out</span>
        <span className={avgMonthlyNet < 0 ? 'over' : ''}><b>{money(avgMonthlyNet)}</b>kept per month on average</span>
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Income and spending</div>
        {loading ? <div className="empty-state">Loading…</div> : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trends} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={monthLabel} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => compact.format(v)} />
              <Tooltip formatter={(v) => money(v)} labelFormatter={monthLabel} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" />
              <Area type="monotone" dataKey="income" name="Income" stroke="#1f6e46" fill="#1f6e46" fillOpacity={0.12} strokeWidth={2.5} />
              <Area type="monotone" dataKey="expenses" name="Spending" stroke="#3d5168" fill="#3d5168" fillOpacity={0.1} strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <div className="card-title">Kept or overspent each month</div>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={net} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={monthLabel} />
            {/* Always include zero, so bars grow from the €0 line even when
                every month is negative (or every month positive). */}
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => compact.format(v).replace(/^-/, '−')}
                   domain={[netTicks[0], netTicks[netTicks.length - 1]]} ticks={netTicks} />
            <ReferenceLine y={0} stroke="#b9c4bc" />
            <Tooltip formatter={(v) => [money(v), v < 0 ? 'Overspent' : 'Kept']} labelFormatter={monthLabel} cursor={{ fill: '#eef2ec' }} contentStyle={TOOLTIP_STYLE} />
            {/* Green when money was kept, red when the month overspent. */}
            <Bar dataKey="net" radius={[5, 5, 0, 0]} maxBarSize={32}>
              {net.map((n) => <Cell key={n.month} fill={n.net < 0 ? '#b42318' : '#1f6e46'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
