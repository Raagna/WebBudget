import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend } from 'recharts';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney } from '../utils/format.js';

export default function Reports() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [months, setMonths] = useState(12);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    setLoading(true);
    client.get('/dashboard/trends', { params: { profileId: activeProfileId, months } }).then((res) => {
      if (!cancelled) { setTrends(res.data.trends); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [activeProfileId, months]);

  const totalIncome = trends.reduce((s, t) => s + (t.income || 0), 0);
  const totalExpenses = trends.reduce((s, t) => s + (t.expenses || 0), 0);
  const avgMonthlyNet = trends.length ? (totalIncome - totalExpenses) / trends.length : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <div className="subtitle">{activeProfile ? `${activeProfile.name} — spending trends over time` : 'Spending trends over time'}</div>
        </div>
        <div className="form-field" style={{ minWidth: 160 }}>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card stat-card"><div className="label">Total Income</div><div className="value positive">{formatMoney(totalIncome)}</div></div>
        <div className="card stat-card"><div className="label">Total Expenses</div><div className="value negative">{formatMoney(totalExpenses)}</div></div>
        <div className="card stat-card"><div className="label">Avg. Monthly Net</div><div className={`value ${avgMonthlyNet >= 0 ? 'positive' : 'negative'}`}>{formatMoney(avgMonthlyNet)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Spending trend</div>
        {loading ? <div className="empty-state">Loading…</div> : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trends} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#dcd6c8" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={{ stroke: '#dcd6c8' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#a6432d" fill="#f3e4de" strokeWidth={2} />
              <Area type="monotone" dataKey="income" name="Income" stroke="#2f5d50" fill="#e4ede9" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <div className="card-title">Net by month</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trends.map((t) => ({ month: t.month, net: (t.income || 0) - (t.expenses || 0) }))}
                    margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#dcd6c8" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={{ stroke: '#dcd6c8' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
            <Bar dataKey="net" radius={[3, 3, 0, 0]} fill="#2f5d50" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
