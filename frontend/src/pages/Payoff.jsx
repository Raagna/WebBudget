import { useCallback, useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, localToday } from '../utils/format.js';
import { monthName, monthShort, duration, chartRows } from '../utils/payoff.js';

// A profile's own loans and credit cards, and the quickest way to clear
// them. (The household "who owes what" tab is the Debts page.) The plans
// are worked out on the server (backend/utils/payoff.js) from what's
// entered here.

const AXIS = { fontSize: 12, fill: '#4f5b55' };
const GRID = '#e3e8e3';
const TOOLTIP_STYLE = { fontSize: 13, borderRadius: 10, borderColor: '#d7ded7', boxShadow: '0 8px 20px -12px rgba(23,33,29,.35)' };

const PLANS = [
  { key: 'avalanche', name: 'Avalanche', how: 'Highest interest rate first', color: '#1f6e46' },
  { key: 'snowball', name: 'Snowball', how: 'Smallest balance first', color: '#1f5fa8' },
  { key: 'minimum', name: 'Minimums only', how: 'No extra, nothing rolled over', color: '#3d5168' },
];

const emptyForm = () => ({ id: null, name: '', balance: '', rate: '', minPayment: '' });

export default function Payoff() {
  const { activeProfileId, activeProfile } = useProfiles();
  const currency = activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [extra, setExtra] = useState('');
  const [saving, setSaving] = useState(false);
  const extraTimer = useRef(null);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await client.get('/payoff', { params: { profileId: activeProfileId, today: localToday() } });
      setData(res.data);
      setError('');
      return res.data;
    } catch {
      setError('Could not load your payoff plan right now.');
    }
  }, [activeProfileId]);

  useEffect(() => {
    setData(null);
    setForm(emptyForm());
    load().then((d) => { if (d) setExtra(d.extra ? String(d.extra) : ''); });
  }, [load]);
  useEffect(() => () => clearTimeout(extraTimer.current), []);

  // The extra is saved a moment after typing stops, and the plans redrawn.
  function changeExtra(text) {
    setExtra(text);
    clearTimeout(extraTimer.current);
    const value = text === '' ? 0 : Number(text);
    if (!Number.isFinite(value) || value < 0) return;
    extraTimer.current = setTimeout(async () => {
      try {
        await client.put('/payoff/settings', { profileId: activeProfileId, extra: value });
        await load();
      } catch (err) {
        setError(err.response?.data?.error || 'Could not save the extra amount.');
      }
    }, 450);
  }

  async function chooseStrategy(strategy) {
    setData((d) => ({ ...d, strategy }));
    try {
      await client.put('/payoff/settings', { profileId: activeProfileId, strategy });
    } catch {
      setError('Could not save which plan you picked.');
    }
  }

  async function saveDebt(e) {
    e.preventDefault();
    const body = {
      name: form.name,
      balance: Number(form.balance),
      rate: form.rate === '' ? NaN : Number(form.rate),
      minPayment: form.minPayment === '' ? NaN : Number(form.minPayment),
    };
    setSaving(true);
    setError('');
    try {
      if (form.id) await client.put(`/payoff/debts/${form.id}`, body);
      else await client.post('/payoff/debts', { ...body, profileId: activeProfileId });
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that debt.');
    } finally {
      setSaving(false);
    }
  }

  function edit(d) {
    setForm({ id: d.id, name: d.name, balance: String(d.balance), rate: String(d.rate), minPayment: String(d.minPayment) });
    document.getElementById('debt-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function remove(d) {
    if (!confirm(`Remove ${d.name} from your payoff plan?`)) return;
    try {
      await client.delete(`/payoff/debts/${d.id}`);
      if (form.id === d.id) setForm(emptyForm());
      await load();
    } catch {
      setError('Could not remove that debt.');
    }
  }

  if (!data) return <div className="empty-state">{error || 'Loading your payoff plan…'}</div>;

  const header = (
    <div className="page-header">
      <div>
        <h1>Payoff plan</h1>
        <div className="subtitle">Your loans and credit cards, and the quickest way to clear them{activeProfile ? ` · ${activeProfile.name}` : ''}</div>
      </div>
    </div>
  );

  const debtForm = (
    <form className="card" id="debt-form" onSubmit={saveDebt}>
      <div className="card-title">{form.id ? `Change ${data.debts.find((d) => d.id === form.id)?.name || 'debt'}` : 'Add a debt'}</div>
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="form-field" style={{ flex: '2 1 180px' }}>
          <label htmlFor="debt-name">Name</label>
          <input id="debt-name" value={form.name} maxLength={80} placeholder="e.g. TD Visa, OSAP"
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="debt-balance">Still owed</label>
          <input id="debt-balance" type="number" min="0.01" step="0.01" inputMode="decimal" value={form.balance}
                 onChange={(e) => setForm({ ...form, balance: e.target.value })} />
        </div>
        <div className="form-field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="debt-rate">Interest, % a year</label>
          <input id="debt-rate" type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="e.g. 19.99" value={form.rate}
                 onChange={(e) => setForm({ ...form, rate: e.target.value })} />
        </div>
        <div className="form-field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="debt-min">Minimum a month</label>
          <input id="debt-min" type="number" min="0" step="0.01" inputMode="decimal" value={form.minPayment}
                 onChange={(e) => setForm({ ...form, minPayment: e.target.value })} />
        </div>
      </div>
      <div className="budget-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>{form.id ? 'Save changes' : 'Add debt'}</button>
        {form.id && <button type="button" className="btn btn-secondary" onClick={() => setForm(emptyForm())}>Cancel</button>}
      </div>
      <p className="fine-print">Use the balance and minimum from your latest statement. Interest is worked out monthly.</p>
    </form>
  );

  if (data.debts.length === 0) {
    return (
      <div>
        {header}
        {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="empty-state">
            <h3>No debts in your plan yet</h3>
            <p>Add each loan or credit card below with what you owe, its interest rate and its minimum payment. You’ll see when you could be debt-free, and which to pay first.</p>
          </div>
        </div>
        {debtForm}
      </div>
    );
  }

  const { plans, strategy } = data;
  const chosen = plans[strategy];
  const minimum = plans.minimum;
  const saved = chosen.paidOff && minimum.paidOff ? minimum.totalInterest - chosen.totalInterest : null;
  const sooner = chosen.paidOff && minimum.paidOff ? minimum.months - chosen.months : null;
  const neverOnMinimums = data.debts.filter((d) => d.minimumTooLow);
  const rows = chartRows(data.thisMonth, plans);
  const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  const names = Object.fromEntries(PLANS.map((p) => [p.key, p.name]));

  return (
    <div>
      {header}
      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

      {/* The answer first: when, and what it saves. */}
      <p className="budget-summary">
        {chosen.paidOff ? (
          <span>
            Debt-free by <b style={{ marginLeft: 6 }}>{monthName(chosen.debtFreeMonth)}</b>
            <span className="change">{chosen.months === 0 ? 'Nothing left to pay' : `${duration(chosen.months)} from now, with ${names[strategy].toLowerCase()}`}</span>
          </span>
        ) : (
          <span className="over">
            <b>Not paid off</b>at this rate
            <span className="change">The payments don’t keep up with the interest. Put more toward it each month.</span>
          </span>
        )}
        {saved !== null && saved > 0 && (
          <span>
            <b>{money(saved)}</b>less interest than minimums only
            {sooner > 0 && <span className="change">and {duration(sooner)} sooner</span>}
          </span>
        )}
        {chosen.paidOff && <span><b>{money(chosen.totalInterest)}</b>interest along the way</span>}
      </p>
      {neverOnMinimums.length > 0 && (
        <p className="payoff-warning">
          <b>{neverOnMinimums.map((d) => d.name).join(', ')}</b> would never be paid off on minimums alone:
          {neverOnMinimums.length === 1 ? ' its minimum doesn’t' : ' their minimums don’t'} cover the monthly interest.
        </p>
      )}

      <div className="debts-grid">
        <div className="card">
          <div className="card-title">Compare plans</div>
          <div className="form-field" style={{ maxWidth: 260, marginBottom: 14 }}>
            <label htmlFor="payoff-extra">Extra each month, on top of minimums</label>
            <input id="payoff-extra" type="number" min="0" step="1" inputMode="decimal" placeholder="0" value={extra}
                   onChange={(e) => changeExtra(e.target.value)} />
          </div>
          <table className="ledger plan-table">
            <thead>
              <tr><th>Plan</th><th>Debt-free</th><th style={{ textAlign: 'right' }}>Interest</th></tr>
            </thead>
            <tbody>
              {PLANS.map((p) => {
                const plan = plans[p.key];
                const pickable = p.key !== 'minimum';
                return (
                  <tr key={p.key} className={p.key === strategy ? 'chosen' : ''}>
                    <td>
                      {pickable ? (
                        <label className="plan-pick">
                          <input type="radio" name="strategy" checked={p.key === strategy} onChange={() => chooseStrategy(p.key)} />
                          <span><b>{p.name}</b><span className="holding-name wraps">{p.how}</span></span>
                        </label>
                      ) : (
                        <span className="plan-pick"><span className="plan-pick-spacer" /><span><b>{p.name}</b><span className="holding-name wraps">{p.how}</span></span></span>
                      )}
                    </td>
                    <td className="col-date">{plan.paidOff ? monthShort(plan.debtFreeMonth) : 'Never'}</td>
                    <td className="amount">{plan.paidOff ? money(plan.totalInterest) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="fine-print">
            Each month every debt gets its minimum, and the extra goes to one debt at a time. When a debt is cleared,
            its minimum moves on to the next. Avalanche usually costs least; snowball clears a debt sooner, which can keep you going.
          </p>
        </div>

        <div className="card">
          <div className="card-title">Order they’re paid off</div>
          <ol className="payoff-order">
            {chosen.order.map((o) => (
              <li key={o.id}>
                <span className="nm">{o.name}</span>
                <span className="when">{monthShort(o.month)}<small>{duration(o.months)}</small></span>
              </li>
            ))}
            {chosen.unpaid.map((u) => (
              <li key={u.id}>
                <span className="nm">{u.name}</span>
                <span className="when over">Not paid off</span>
              </li>
            ))}
          </ol>
          <p className="fine-print">With {names[strategy].toLowerCase()}, starting with next month’s payment.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">What you’ll owe over time</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={monthShort} minTickGap={28} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => compact.format(v)} />
            <Tooltip formatter={(v, name) => [money(v), name]} labelFormatter={monthShort} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" />
            {PLANS.map((p) => (
              <Line key={p.key} type="monotone" dataKey={p.key} name={p.name} stroke={p.color} dot={false}
                    strokeWidth={p.key === strategy ? 3 : 2} strokeDasharray={p.key === 'minimum' ? '5 4' : undefined}
                    isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Your debts</div>
        <p className="budget-summary" style={{ marginBottom: 10 }}>
          <span><b>{money(data.totals.balance)}</b>owed</span>
          <span><b>{money(data.totals.minPayments + (Number(extra) || 0))}</b>a month toward it</span>
        </p>
        <table className="ledger stack">
          <thead>
            <tr><th>Debt</th><th style={{ textAlign: 'right' }}>Owed</th><th>Interest a year</th><th>Minimum a month</th><th><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {data.debts.map((d) => (
              <tr key={d.id}>
                <td className="col-desc">
                  {d.name}
                  {d.minimumTooLow && <span className="holding-name wraps warn-text">Minimum is under the {money(d.monthlyInterest)} monthly interest</span>}
                </td>
                <td className="amount col-amount">{money(d.balance)}</td>
                {/* The header says what these are; a phone hides the header, so the words come back there. */}
                <td className="col-date">{d.rate}%<span className="only-stacked"> interest</span></td>
                <td className="col-by">{money(d.minPayment)}<span className="only-stacked"> minimum a month</span></td>
                <td className="col-actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => edit(d)}>Edit</button>{' '}
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(d)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {debtForm}
    </div>
  );
}
