import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import client from '../api/client';
import { Link } from 'react-router-dom';
import StatCard from '../components/StatCard.jsx';
import BudgetBar from '../components/BudgetBar.jsx';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate, localToday } from '../utils/format.js';
import { CURRENCIES } from '../utils/currencies.js';

const PIE_COLORS = ['#2f5d50', '#b8933a', '#a6432d', '#6b8f87', '#c9a876', '#7a3f30', '#4a746a', '#8f6b2e'];

export default function Dashboard() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        const [summaryRes, trendsRes, budgetsRes] = await Promise.all([
          client.get('/dashboard/summary', { params: { profileId: activeProfileId, today: localToday() } }),
          client.get('/dashboard/trends', { params: { profileId: activeProfileId, months: 9, today: localToday() } }),
          // Budgets are a bonus here: if they fail, still show the dashboard.
          client.get('/budgets', { params: { profileId: activeProfileId, today: localToday() } }).catch(() => null),
        ]);
        if (cancelled) return;
        setSummary(summaryRes.data);
        setTrends(trendsRes.data.trends);
        setBudgets(budgetsRes?.data.budgets || []);
      } catch (err) {
        if (!cancelled) setError('Could not load your dashboard right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeProfileId]);

  if (loading || !summary) return <div className="empty-state">Loading your dashboard…</div>;
  if (error) return <div className="empty-state">{error}</div>;

  const net = summary.net;
  const safe = summary.safeToSpend;
  const currency = activeProfile?.currency || 'USD';
  const currencySymbol = CURRENCIES.find((c) => c.code === currency)?.symbol || '$';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">{activeProfile ? `${activeProfile.name} — this month at a glance` : 'This month at a glance'}</div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Monthly Income" value={formatMoney(summary.income, { currency })} tone="positive" />
        <StatCard label="Monthly Expenses" value={formatMoney(summary.expenses, { currency })} tone="negative" />
        {safe ? (
          <StatCard
            label="Safe to spend"
            value={formatMoney(safe.amount, { currency })}
            tone={safe.amount >= 0 ? 'positive' : 'negative'}
            hint={safe.amount >= 0
              ? `About ${formatMoney(safe.perDay, { currency })} a day for ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'}`
              : 'More is committed than has come in this month'}
          />
        ) : (
          <StatCard label="Net" value={formatMoney(net, { currency })} tone={net >= 0 ? 'positive' : 'negative'} />
        )}
        <StatCard label="Largest Category" value={summary.largestCategory || '—'} />
      </div>

      <div className="chart-grid">
        {safe && (
          <div className="card">
            <div className="card-title">How "safe to spend" is worked out</div>
            <ul className="safe-breakdown">
              <li><span>Income so far</span><span className="amount">{formatMoney(safe.income, { currency })}</span></li>
              <li><span>Spent so far</span><span className="amount">−{formatMoney(safe.spent, { currency })}</span></li>
              <li><span>Bills still due this month</span><span className="amount">−{formatMoney(safe.billsDue, { currency })}</span></li>
              {safe.scheduled > 0 && (
                <li><span>Scheduled later this month ({safe.scheduledCount})</span><span className="amount">−{formatMoney(safe.scheduled, { currency })}</span></li>
              )}
              <li><span>Safe to spend</span><span className="amount">{formatMoney(safe.amount, { currency })}</span></li>
            </ul>
            {safe.upcomingBills.length > 0 && (
              <ul className="upcoming-bills">
                {safe.upcomingBills.map((b) => (
                  <li key={b.id} className={b.overdue ? 'overdue' : ''}>
                    <span>{b.name} · {b.overdue ? 'overdue' : `due ${formatDate(b.dueOn)}`}</span>
                    <span className="amount">{formatMoney(b.amount, { currency })}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="hint" style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>
              Income you're still expecting this month isn't counted until it arrives.
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-title">
            Budgets
            <Link to="/budgets" style={{ fontSize: 12, fontWeight: 500 }}>{budgets.length ? 'See all' : 'Set up'}</Link>
          </div>
          {budgets.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
              Set a monthly limit for categories like groceries or eating out, and see how close you are as you spend.
            </p>
          ) : (
            budgets.slice(0, 4).map((b) => <BudgetBar key={b.id} budget={b} currency={currency} compact />)
          )}
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <div className="card-title">Income vs. expenses</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trends} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#dcd6c8" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={{ stroke: '#dcd6c8' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={false} tickLine={false} width={60}
                     tickFormatter={(v) => `${currencySymbol}${v}`} />
              <Tooltip formatter={(v) => formatMoney(v, { currency })} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
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
                <Tooltip formatter={(v) => formatMoney(v, { currency })} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
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
            <YAxis tick={{ fontSize: 11, fill: '#5b6663' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${currencySymbol}${v}`} />
            <Tooltip formatter={(v) => formatMoney(v, { currency })} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: '#dcd6c8' }} />
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
          <table className="ledger stack">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {summary.recentTransactions.map((t) => (
                <tr key={t.id}>
                  <td className="mono col-date">{formatDate(t.date)}</td>
                  <td className="col-desc">{t.description}</td>
                  <td className="col-cat"><span className="tag">{t.category}</span></td>
                  <td className={`amount col-amount ${t.type}`}>{t.type === 'income' ? '+' : '-'}{formatMoney(t.amount, { currency })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
