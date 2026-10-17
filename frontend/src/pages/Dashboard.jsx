import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate, localToday } from '../utils/format.js';
import { categoryColor } from '../utils/categoryColors.js';
import { changeVsLastMonth } from '../utils/change.js';

const AXIS = { fontSize: 12, fill: '#4f5b55' };
const GRID = '#e3e8e3';
const TOOLTIP_STYLE = { fontSize: 13, borderRadius: 10, borderColor: '#d7ded7', boxShadow: '0 8px 20px -12px rgba(23,33,29,.35)' };
const BILLS_COLOR = '#3d5168'; // slate: the "bills" denomination

const monthShort = (yyyyMm) => new Date(`${yyyyMm}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

// Axis labels stay short: "€1.2K" rather than "€1200".
function compactMoney(currency) {
  const f = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  return (v) => f.format(v).replace(/^-/, '−');
}

function NotePanel({ safe, summary, currency }) {
  const money = (v) => formatMoney(v, { currency });
  if (!safe) {
    return (
      <section className={`note-panel${summary.net < 0 ? ' negative' : ''}`} aria-labelledby="note-title">
        <div className="note-head">
          <h2 id="note-title">Net this month</h2>
          <div className="note-figure">{money(summary.net)}</div>
        </div>
      </section>
    );
  }
  const negative = safe.amount < 0;
  const change = changeVsLastMonth(summary.expenses, summary.lastMonthToDate?.expenses, currency);
  return (
    <section className={`note-panel${negative ? ' negative' : ''}`} aria-labelledby="note-title">
      <div className="note-head">
        <h2 id="note-title">Safe to spend</h2>
        <div className="note-figure">{money(safe.amount)}</div>
      </div>
      <p className="note-caption">
        {negative
          ? 'More is set aside for this month than has come in. Income you are still expecting isn’t counted until it arrives.'
          : 'What’s left this month once spending, bills still due and anything scheduled are set aside. Income still on its way isn’t counted.'}
        {change && <span className="note-change">Spending is {change}.</span>}
      </p>

      {/* The sum, written out, so the number can be checked at a glance.
          Each operator travels with the amount after it, so a wrap never
          strands a "−" or "=" at the end of a line. */}
      <p className="note-sum" aria-label="How it is worked out">
        <span className="term"><span className="tv"><b>{money(safe.income)}</b>income so far</span></span>
        <span className="term"><span className="op" aria-hidden="true">−</span><span className="tv"><b>{money(safe.spent)}</b>spent</span></span>
        <span className="term"><span className="op" aria-hidden="true">−</span><span className="tv"><b>{money(safe.billsDue)}</b>bills due</span></span>
        <span className="term"><span className="op" aria-hidden="true">−</span><span className="tv"><b>{money(safe.scheduled)}</b>scheduled{safe.scheduledCount ? ` (${safe.scheduledCount})` : ''}</span></span>
        <span className="term result"><span className="op" aria-hidden="true">=</span><span className="tv"><b>{money(safe.amount)}</b>safe to spend</span></span>
      </p>

      {/* The note's clear window: a real readout, not decoration. */}
      <div className="note-window">
        <div>
          <div className="w-figure">{money(safe.perDay)}</div>
          <div className="w-label">a day</div>
        </div>
        <hr />
        <div>
          <div className="w-figure">{safe.daysLeft}</div>
          <div className="w-label">day{safe.daysLeft === 1 ? '' : 's'} left</div>
        </div>
      </div>
    </section>
  );
}

// Beside the note: the categories closest to their limit, each in its own
// denomination colour, plus what's still owed in bills. The strips stretch
// to the note's height so the column never trails off into empty space.
function StripColumn({ budgets, safe, currency }) {
  const money = (v) => formatMoney(v, { currency });
  const shown = budgets.slice(0, safe ? 3 : 4);
  const bills = safe?.upcomingBills || [];
  return (
    <div className="strip-stack">
      {shown.map((b) => {
        const over = b.remaining < 0;
        const change = changeVsLastMonth(b.spent, b.lastMonthSpent, currency);
        return (
          <Link key={b.id} to="/budgets" className={`cat-strip${over ? ' over' : ''}`} style={{ '--cat': categoryColor(b.categoryName) }}>
            <div className="row">
              <span className="nm">{b.categoryName}</span>
              <span className="left">{over ? `${money(-b.remaining)} over` : `${money(b.remaining)} left`}</span>
            </div>
            <div className="sub">{money(b.spent)} of {money(b.amount)}{change ? ` · ${change}` : ''}</div>
            <div className="track"><span style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
          </Link>
        );
      })}
      {shown.length === 0 && (
        <div className="strip-empty">
          <strong style={{ color: 'var(--ink)' }}>No budgets yet.</strong> Give categories like groceries or eating out a
          monthly limit and they’ll show here in their own colours. <Link to="/budgets">Set a budget</Link>
        </div>
      )}
      {safe && (
        <Link to="/bills" className="cat-strip bills" style={{ '--cat': BILLS_COLOR }}>
          <div className="row">
            <span className="nm">Bills due</span>
            <span className="left">{bills.length ? `${money(safe.billsDue)} owed` : 'All paid'}</span>
          </div>
          <div className="sub">
            {bills.length === 0
              ? 'Nothing unpaid due this month'
              : bills.slice(0, 3).map((b) => `${b.name} ${b.overdue ? 'overdue' : formatDate(b.dueOn).replace(/, \d{4}$/, '')}`).join(' · ')}
          </div>
        </Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    setError('');
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
      } catch {
        if (!cancelled) setError('Could not load your dashboard right now. Check your connection and refresh.');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeProfileId]);

  if (error) return <div className="empty-state">{error}</div>;
  if (!summary) return <div className="empty-state">Loading your dashboard…</div>;

  const safe = summary.safeToSpend;
  const currency = activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const axisMoney = compactMoney(currency);
  const monthName = new Date(`${summary.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const byCategory = summary.spendingByCategory;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{monthName}</h1>
          <div className="subtitle">
            {activeProfile?.name}{safe ? ` · ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'} left this month` : ''}
          </div>
        </div>
        <Link to="/transactions?add=1" className="btn btn-primary">Add or scan a transaction</Link>
      </div>

      <div className="dash-top">
        <NotePanel safe={safe} summary={summary} currency={currency} />
        <StripColumn budgets={budgets} safe={safe} currency={currency} />
      </div>

      <div className="chart-grid">
        <div className="card">
          <div className="card-title">
            Recent transactions
            <Link to="/transactions">See all</Link>
          </div>
          {summary.recentTransactions.length === 0 ? (
            <div className="empty-state">
              <h3>Nothing here yet</h3>
              <p><Link to="/transactions?add=1">Add your first transaction</Link> or import a CSV from your bank.</p>
            </div>
          ) : (
            <table className="ledger stack">
              <thead>
                <tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
              </thead>
              <tbody>
                {summary.recentTransactions.slice(0, 6).map((t) => (
                  <tr key={t.id}>
                    <td className="col-date">{formatDate(t.date)}</td>
                    <td className="col-desc">{t.description}</td>
                    <td className="col-cat"><span className="tag cat" style={{ '--cat': categoryColor(t.category) }}>{t.category}</span></td>
                    <td className={`amount col-amount ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title">Where it went</div>
          {byCategory.length === 0 ? (
            <div className="empty-state">No spending logged this month yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, byCategory.length * 34 + 20)}>
              <BarChart data={byCategory} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="category" tick={AXIS} axisLine={false} tickLine={false} width={110} />
                <Tooltip formatter={(v) => money(v)} cursor={{ fill: '#eef2ec' }} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="total" name="Spent" radius={[0, 6, 6, 0]}>
                  {byCategory.map((c) => <Cell key={c.category} fill={categoryColor(c.category)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Income and spending, last 9 months
          <Link to="/reports">Reports</Link>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trends} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={monthShort} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={axisMoney} />
            <Tooltip formatter={(v) => money(v)} labelFormatter={monthShort} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" />
            <Line type="monotone" dataKey="income" name="Income" stroke="#1f6e46" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="expenses" name="Spending" stroke="#3d5168" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
