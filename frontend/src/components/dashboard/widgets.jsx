import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { formatMoney, formatDate } from '../../utils/format.js';
import { categoryColor } from '../../utils/categoryColors.js';
import { changeVsLastMonth } from '../../utils/change.js';
import InvestmentsCard from '../InvestmentsCard.jsx';
import NewsCard from '../NewsCard.jsx';
import RedditCard from '../RedditCard.jsx';
import DebtsCard from '../DebtsCard.jsx';
import PayoffCard from '../PayoffCard.jsx';
import { NetWorthCard, GoalsCard } from '../NetWorthCard.jsx';

// Every dashboard widget. Each one fills the grid cell it's given (the
// user picks the size), so cards stretch to 100% height and anything
// taller than the cell scrolls inside it rather than spilling out.

const AXIS = { fontSize: 12, fill: '#4f5b55' };
const GRID_LINE = '#e3e8e3';
const TOOLTIP_STYLE = { fontSize: 13, borderRadius: 10, borderColor: '#d7ded7', boxShadow: '0 8px 20px -12px rgba(23,33,29,.35)' };
const BILLS_COLOR = '#3d5168'; // slate: the "bills" denomination

const monthShort = (yyyyMm) => new Date(`${yyyyMm}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

// Axis labels stay short: "€1.2K" rather than "€1200".
function compactMoney(currency) {
  const f = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  return (v) => f.format(v).replace(/^-/, '−');
}

function NotePanel({ summary, currency }) {
  const safe = summary.safeToSpend;
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

// The categories closest to their limit, each in its own denomination
// colour, plus what's still owed in bills. The strips share the widget's
// height so the column never trails off into empty space.
function StripColumn({ summary, budgets, currency }) {
  const safe = summary.safeToSpend;
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

function RecentCard({ summary, currency }) {
  const money = (v) => formatMoney(v, { currency });
  return (
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
            <tr><th>Date</th><th>Description</th><th className="col-cat">Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
          </thead>
          <tbody>
            {summary.recentTransactions.slice(0, 10).map((t) => (
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
  );
}

function CategoriesCard({ summary, currency }) {
  const byCategory = summary.spendingByCategory;
  return (
    <div className="card">
      <div className="card-title">Where it went</div>
      {byCategory.length === 0 ? (
        <div className="empty-state">No spending logged this month yet.</div>
      ) : (
        <div className="card-fill" style={{ minHeight: byCategory.length * 26 + 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byCategory} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" tick={AXIS} axisLine={false} tickLine={false} width={110} />
              <Tooltip formatter={(v) => formatMoney(v, { currency })} cursor={{ fill: '#eef2ec' }} contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="total" name="Spent" radius={[0, 6, 6, 0]}>
                {byCategory.map((c) => <Cell key={c.category} fill={categoryColor(c.category)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function TrendCard({ trends, currency }) {
  return (
    <div className="card">
      <div className="card-title">
        Income and spending, last 9 months
        <Link to="/reports">Reports</Link>
      </div>
      <div className="card-fill" style={{ minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trends} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_LINE} vertical={false} />
            <XAxis dataKey="month" tick={AXIS} axisLine={{ stroke: GRID_LINE }} tickLine={false} tickFormatter={monthShort} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={compactMoney(currency)} />
            <Tooltip formatter={(v) => formatMoney(v, { currency })} labelFormatter={monthShort} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" />
            <Line type="monotone" dataKey="income" name="Income" stroke="#1f6e46" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="expenses" name="Spending" stroke="#3d5168" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// The catalogue. `size` is where a widget starts when added (w out of 12
// columns, h in 20px rows); `min` is the smallest it can be resized to
// and still make sense.
export const WIDGETS = {
  safe: {
    title: 'Safe to spend',
    size: { w: 7, h: 14 }, min: { w: 4, h: 9 },
    render: (ctx) => <NotePanel {...ctx} />,
  },
  budgets: {
    title: 'Budgets and bills',
    size: { w: 5, h: 14 }, min: { w: 3, h: 7 },
    render: (ctx) => <StripColumn {...ctx} />,
  },
  recent: {
    title: 'Recent transactions',
    size: { w: 7, h: 12 }, min: { w: 3, h: 6 },
    render: (ctx) => <RecentCard {...ctx} />,
  },
  categories: {
    title: 'Where it went',
    size: { w: 5, h: 12 }, min: { w: 3, h: 6 },
    render: (ctx) => <CategoriesCard {...ctx} />,
  },
  investments: {
    title: 'Investments',
    size: { w: 7, h: 14 }, min: { w: 3, h: 6 },
    render: (ctx) => <InvestmentsCard profileId={ctx.profileId} />,
  },
  news: {
    title: 'Financial news',
    size: { w: 5, h: 14 }, min: { w: 3, h: 6 },
    render: () => <NewsCard />,
  },
  trend: {
    title: 'Income and spending',
    size: { w: 12, h: 9 }, min: { w: 4, h: 7 },
    render: (ctx) => <TrendCard {...ctx} />,
  },
  reddit: {
    title: 'Reddit',
    size: { w: 5, h: 14 }, min: { w: 3, h: 8 },
    render: () => <RedditCard />,
  },
  // Not on the default dashboard (most budgets are one person's); a
  // household adds it from "Add a widget".
  debts: {
    title: 'Who owes what',
    size: { w: 5, h: 10 }, min: { w: 3, h: 6 },
    render: (ctx) => <DebtsCard profileId={ctx.profileId} currency={ctx.currency} />,
  },
  // Also not on the default dashboard: only useful once debts are entered.
  payoff: {
    title: 'Payoff plan',
    size: { w: 5, h: 10 }, min: { w: 3, h: 6 },
    render: (ctx) => <PayoffCard profileId={ctx.profileId} currency={ctx.currency} />,
  },
  networth: {
    title: 'Net worth',
    size: { w: 5, h: 10 }, min: { w: 3, h: 6 },
    render: (ctx) => <NetWorthCard profileId={ctx.profileId} />,
  },
  goals: {
    title: 'Savings goals',
    size: { w: 5, h: 12 }, min: { w: 3, h: 6 },
    render: (ctx) => <GoalsCard profileId={ctx.profileId} currency={ctx.currency} />,
  },
};
