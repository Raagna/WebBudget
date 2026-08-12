import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import client from '../api/client';
import StatCard from '../components/StatCard.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

const PIE_COLORS = ['#2f5d50', '#b8933a', '#a6432d', '#6b8f87', '#c9a876', '#7a3f30', '#4a746a', '#8f6b2e'];

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [summaryRes, trendsRes] = await Promise.all([
          client.get('/dashboard/summary'),
          client.get('/dashboard/trends?months=9'),
        ]);
        if (cancelled) return;
        setSummary(summaryRes.data);
        setTrends(trendsRes.data.trends);
      } catch (err) {
        if (!cancelled) setError('Could not load your dashboard right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="empty-state">Loading your dashboard…</div>;
  if (error) return <div className="empty-state">{error}</div>;

  const net = summary.net;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">This month at a glance</div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Monthly Income" value={formatMoney(summary.income)} tone="positive" />
        <StatCard label="Monthly Expenses" value={formatMoney(summary.expenses)} tone="negative" />
        <StatCard
          label="Remaining"
          value={formatMoney(net)}
          tone={net >= 0 ? 'positive' : 'negative'}
          hint={net >= 0 ? 'On track this month' : 'Spending exceeds income'}
        />
        <StatCard label="Largest Category" value={summary.largestCategory || '—'} />
        <StatCard
          label="Upcoming Bills"
          value={summary.upcomingBills.count}
          hint={formatMoney(summary.upcomingBills.total) + ' due'}
        />
        <StatCard
          label="Active Subscriptions"
          value={summary.activeSubscriptions.count}
          hint={formatMoney(summary.activeSubscriptions.total) + ' / mo'}
        />
      </div>

      <div className="chart-grid">
        <div className="card">
          <div className="card-title">Income vs. expenses</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trends} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#dcd6c8" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={{ stroke: '#dcd6c8' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={false} tickLine={false} width={60}
                     tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="income" name="Income" stroke="#2f5d50" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#a6432d" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">This month's spending</div>
          {summary.spendingByCategory.length === 0 ? (
            <div className="empty-state">No expenses logged this month yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={summary.spendingByCategory}
                  dataKey="total"
                  nameKey="category"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={1}
                >
                  {summary.spendingByCategory.map((entry, i) => (
                    <Cell key={entry.category} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Spending by category</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={summary.spendingByCategory} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#dcd6c8" vertical={false} />
            <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={{ stroke: '#dcd6c8' }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
            <Bar dataKey="total" fill="#2f5d50" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="card-title">Recent transactions</div>
        {summary.recentTransactions.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing here yet</h3>
            <p>Add your first transaction to see it show up here.</p>
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {summary.recentTransactions.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{formatDate(t.date)}</td>
                  <td>{t.description}</td>
                  <td><span className="tag">{t.category}</span></td>
                  <td className={`amount ${t.type}`}>{t.type === 'income' ? '+' : '-'}{formatMoney(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
