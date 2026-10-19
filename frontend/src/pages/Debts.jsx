import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate, localToday } from '../utils/format.js';

// "You" in sentences instead of your own name.
function who(id, name, you, capital = false) {
  if (id !== you) return name;
  return capital ? 'You' : 'you';
}

// One line a person can read: "You owe Sam CA$12.00", "Alex owes you ...".
function settleText(p, you, money) {
  if (p.from === you) return <>You owe <b>{p.toName}</b> {money(p.amount)}</>;
  if (p.to === you) return <><b>{p.fromName}</b> owes you {money(p.amount)}</>;
  return <><b>{p.fromName}</b> owes <b>{p.toName}</b> {money(p.amount)}</>;
}

const emptyCost = () => ({ description: '', amount: '', date: localToday(), paidBy: '', split: 'equal', between: null, custom: {} });
const emptyPayment = () => ({ from: '', to: '', amount: '', date: localToday(), note: '' });

export default function Debts() {
  const { activeProfileId, activeProfile } = useProfiles();
  const currency = activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cost, setCost] = useState(emptyCost);
  const [payment, setPayment] = useState(emptyPayment);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await client.get('/debts', { params: { profileId: activeProfileId } });
      setData(res.data);
      setError('');
    } catch {
      setError('Could not load who owes what right now.');
    }
  }, [activeProfileId]);

  useEffect(() => { setData(null); setCost(emptyCost()); setPayment(emptyPayment()); load(); }, [load]);

  const members = data?.members || [];
  const you = data?.you;
  // Until someone changes them: "paid by" is you, and it's split between everyone.
  const paidBy = cost.paidBy === '' ? you : Number(cost.paidBy);
  const between = cost.between ?? members.map((m) => m.id);
  const customTotal = useMemo(
    () => members.reduce((sum, m) => sum + (Number(cost.custom[m.id]) || 0), 0),
    [members, cost.custom]
  );

  async function save(request, after) {
    setSaving(true);
    setError('');
    try {
      await request();
      after();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  function addCost(e) {
    e.preventDefault();
    const amount = Number(cost.amount);
    const body = { profileId: activeProfileId, description: cost.description, amount, date: cost.date, paidBy, split: cost.split };
    if (cost.split === 'equal') body.between = between;
    else body.shares = members.map((m) => ({ userId: m.id, amount: Number(cost.custom[m.id]) || 0 })).filter((s) => s.amount > 0);
    save(() => client.post('/debts', body), () => setCost(emptyCost()));
  }

  function addPayment(e) {
    e.preventDefault();
    save(
      () => client.post('/debts/payments', {
        profileId: activeProfileId, from: Number(payment.from), to: Number(payment.to),
        amount: Number(payment.amount), date: payment.date, note: payment.note,
      }),
      () => setPayment(emptyPayment())
    );
  }

  // "Record payment" on a settle-up line fills in the payment form.
  function prefillPayment(p) {
    setPayment({ ...emptyPayment(), from: String(p.from), to: String(p.to), amount: String(p.amount) });
    document.getElementById('payment-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function remove(entry) {
    const label = entry.kind === 'payment' ? `the ${money(entry.amount)} payment` : `"${entry.description}"`;
    if (!confirm(`Delete ${label}? Everyone's balance will be worked out again without it.`)) return;
    save(() => client.delete(`/debts/${entry.id}`), () => {});
  }

  if (!data) return <div className="empty-state">{error || 'Loading…'}</div>;

  const header = (
    <div className="page-header">
      <div>
        <h1>Who owes what</h1>
        <div className="subtitle">Shared costs and paybacks{activeProfile ? ` in ${activeProfile.name}` : ''}</div>
      </div>
    </div>
  );

  if (members.length < 2) {
    return (
      <div>
        {header}
        <div className="card">
          <div className="empty-state">
            <h3>Only you are in this budget</h3>
            <p>
              Keeping a tab needs at least two people. Switch to a household budget, or{' '}
              <Link to="/profiles">invite someone to this one</Link>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const yourNet = data.yourNet;
  const settledAll = data.settleUp.length === 0;

  return (
    <div>
      {header}
      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

      <p className="budget-summary">
        {yourNet > 0 && <span><b className="delta up">{money(yourNet)}</b>owed to you</span>}
        {yourNet < 0 && <span className="over"><b>{money(-yourNet)}</b>you owe</span>}
        {yourNet === 0 && <span><b>All square</b>you don’t owe anyone, and nobody owes you</span>}
      </p>

      <div className="debts-grid">
        <div className="card">
          <div className="card-title">Settle up</div>
          {settledAll ? (
            <p className="fine-print" style={{ marginTop: 0 }}>Everyone is square. Nothing to pay back.</p>
          ) : (
            <ul className="settle-list">
              {data.settleUp.map((p) => (
                <li key={`${p.from}-${p.to}`}>
                  <span>{settleText(p, you, money)}</span>
                  {p.from !== null && p.to !== null && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => prefillPayment(p)}>Record payment</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="fine-print">The fewest payments that would square everyone up.</p>
        </div>

        <div className="card">
          <div className="card-title">Balances</div>
          <ul className="settle-list">
            {data.balances.map((b) => (
              <li key={b.id ?? 'former'}>
                <span>{who(b.id, b.name, you, true)}{!b.member && <span className="default-note">Not in the household now</span>}</span>
                <span className={`delta ${b.net > 0 ? 'up' : b.net < 0 ? 'down' : ''}`}>
                  {b.net > 0 ? `is owed ${money(b.net)}` : b.net < 0 ? `owes ${money(-b.net)}` : 'square'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="debts-grid">
        <form className="card" onSubmit={addCost}>
          <div className="card-title">Add a shared cost</div>
          <div className="filter-bar" style={{ marginBottom: 12 }}>
            <div className="form-field" style={{ flex: '2 1 200px' }}>
              <label htmlFor="cost-desc">What for</label>
              <input id="cost-desc" value={cost.description} maxLength={200} placeholder="e.g. Costco run"
                     onChange={(e) => setCost({ ...cost, description: e.target.value })} />
            </div>
            <div className="form-field" style={{ flex: '1 1 110px' }}>
              <label htmlFor="cost-amount">Amount</label>
              <input id="cost-amount" type="number" min="0.01" step="0.01" value={cost.amount}
                     onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
            </div>
            <div className="form-field" style={{ flex: '1 1 140px' }}>
              <label htmlFor="cost-date">Date</label>
              <input id="cost-date" type="date" value={cost.date} onChange={(e) => setCost({ ...cost, date: e.target.value })} />
            </div>
            <div className="form-field" style={{ flex: '1 1 140px' }}>
              <label htmlFor="cost-paid">Paid by</label>
              <select id="cost-paid" value={paidBy} onChange={(e) => setCost({ ...cost, paidBy: e.target.value })}>
                {members.map((m) => <option key={m.id} value={m.id}>{who(m.id, m.name, you, true)}</option>)}
              </select>
            </div>
          </div>

          <fieldset className="split-choice">
            <legend>Split</legend>
            <label><input type="radio" name="split" checked={cost.split === 'equal'} onChange={() => setCost({ ...cost, split: 'equal' })} /> Equally</label>
            <label><input type="radio" name="split" checked={cost.split === 'custom'} onChange={() => setCost({ ...cost, split: 'custom' })} /> By amount</label>
          </fieldset>

          {cost.split === 'equal' ? (
            <div className="split-people">
              {members.map((m) => (
                <label key={m.id} className="check">
                  <input type="checkbox" checked={between.includes(m.id)}
                         onChange={(e) => setCost({ ...cost, between: e.target.checked ? [...between, m.id] : between.filter((id) => id !== m.id) })} />
                  {who(m.id, m.name, you, true)}
                  {between.includes(m.id) && Number(cost.amount) > 0 && (
                    <span className="split-each">{money(Number(cost.amount) / between.length)}</span>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <div className="split-people">
              {members.map((m) => (
                <label key={m.id} className="check custom">
                  <span>{who(m.id, m.name, you, true)}</span>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={cost.custom[m.id] ?? ''}
                         aria-label={`${m.name}'s share`}
                         onChange={(e) => setCost({ ...cost, custom: { ...cost.custom, [m.id]: e.target.value } })} />
                </label>
              ))}
              {Number(cost.amount) > 0 && (
                <p className={`fine-print${Math.abs(customTotal - Number(cost.amount)) > 0.004 ? ' warn-text' : ''}`} style={{ margin: 0 }}>
                  Shares add up to {money(customTotal)} of {money(Number(cost.amount))}
                </p>
              )}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 14 }}>Add cost</button>
        </form>

        <form className="card" id="payment-form" onSubmit={addPayment}>
          <div className="card-title">Record a payment</div>
          <div className="filter-bar" style={{ marginBottom: 12 }}>
            <div className="form-field" style={{ flex: '1 1 140px' }}>
              <label htmlFor="pay-from">Who paid</label>
              <select id="pay-from" value={payment.from} onChange={(e) => setPayment({ ...payment, from: e.target.value })}>
                <option value="">Choose…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{who(m.id, m.name, you, true)}</option>)}
              </select>
            </div>
            <div className="form-field" style={{ flex: '1 1 140px' }}>
              <label htmlFor="pay-to">Paid to</label>
              <select id="pay-to" value={payment.to} onChange={(e) => setPayment({ ...payment, to: e.target.value })}>
                <option value="">Choose…</option>
                {members.filter((m) => String(m.id) !== payment.from).map((m) => <option key={m.id} value={m.id}>{who(m.id, m.name, you, true)}</option>)}
              </select>
            </div>
            <div className="form-field" style={{ flex: '1 1 110px' }}>
              <label htmlFor="pay-amount">Amount</label>
              <input id="pay-amount" type="number" min="0.01" step="0.01" value={payment.amount}
                     onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
            </div>
            <div className="form-field" style={{ flex: '1 1 140px' }}>
              <label htmlFor="pay-date">Date</label>
              <input id="pay-date" type="date" value={payment.date} onChange={(e) => setPayment({ ...payment, date: e.target.value })} />
            </div>
          </div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label htmlFor="pay-note">Note (optional)</label>
            <input id="pay-note" value={payment.note} maxLength={200} placeholder="e.g. e-Transfer for groceries"
                   onChange={(e) => setPayment({ ...payment, note: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>Record payment</button>
        </form>
      </div>

      <div className="card">
        <div className="card-title">History</div>
        {data.entries.length === 0 ? (
          <div className="empty-state">Nothing on the tab yet. Add a shared cost above.</div>
        ) : (
          <table className="ledger stack">
            <thead><tr><th>Date</th><th>What</th><th>Split</th><th style={{ textAlign: 'right' }}>Amount</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="col-date">{formatDate(e.date)}</td>
                  <td className="col-desc">
                    {e.kind === 'payment'
                      ? <>{who(e.paidBy, e.paidByName, you, true)} paid {who(e.shares[0]?.userId, e.shares[0]?.name, you)} back</>
                      : e.description}
                    <span className="holding-name">
                      {e.kind === 'payment' ? (e.description || 'Payment') : `Paid by ${who(e.paidBy, e.paidByName, you)}`}
                    </span>
                  </td>
                  <td className="col-by">
                    {e.kind === 'expense' && e.shares.map((s) => `${who(s.userId, s.name, you, true)} ${money(s.amount)}`).join(' · ')}
                  </td>
                  <td className="amount col-amount">{money(e.amount)}</td>
                  <td className="col-actions" style={{ textAlign: 'right' }}>
                    {e.canDelete && <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(e)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
