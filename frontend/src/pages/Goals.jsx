import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate, localToday } from '../utils/format.js';
import { categoryColor } from '../utils/categoryColors.js';

const monthYear = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

// What a goal needs next, in one sentence.
function statusLine(g, money) {
  if (g.status === 'reached') return 'Reached. Nicely done.';
  if (g.status === 'overdue') return `The target date has passed, with ${money(g.remaining)} to go.`;
  if (g.perMonth !== null) {
    return g.monthsLeft === 1
      ? `Put in ${money(g.perMonth)} this month to reach it by ${monthYear(g.targetDate)}.`
      : `Put in ${money(g.perMonth)} a month to reach it by ${monthYear(g.targetDate)}.`;
  }
  return `${money(g.remaining)} to go.`;
}

const emptyGoal = { name: '', target: '', targetDate: '', startingAmount: '' };

export default function Goals() {
  const { activeProfileId, activeProfile } = useProfiles();
  const currency = activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyGoal);
  const [saving, setSaving] = useState(false);
  // One goal at a time can have its money form, edit form or history open.
  const [open, setOpen] = useState(null); // { id, mode: 'add' | 'take' | 'edit' | 'history' }
  const [amount, setAmount] = useState('');
  const [edit, setEdit] = useState(emptyGoal);
  const [history, setHistory] = useState([]);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await client.get('/goals', { params: { profileId: activeProfileId, today: localToday() } });
      setData(res.data);
      setError('');
    } catch {
      setError('Could not load your goals right now.');
    }
  }, [activeProfileId]);

  useEffect(() => { setData(null); setOpen(null); load(); }, [load]);

  async function run(request, after) {
    setSaving(true);
    setError('');
    try {
      await request();
      after?.();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  function toggle(g, mode) {
    if (open?.id === g.id && open.mode === mode) { setOpen(null); return; }
    setOpen({ id: g.id, mode });
    setAmount('');
    if (mode === 'edit') setEdit({ name: g.name, target: String(g.target), targetDate: g.targetDate || '' });
    if (mode === 'history') {
      setHistory([]);
      client.get(`/goals/${g.id}/contributions`).then((res) => setHistory(res.data.contributions)).catch(() => {});
    }
  }

  function addGoal(e) {
    e.preventDefault();
    run(() => client.post('/goals', {
      profileId: activeProfileId,
      name: form.name,
      target: Number(form.target),
      targetDate: form.targetDate || null,
      startingAmount: form.startingAmount ? Number(form.startingAmount) : null,
    }), () => setForm(emptyGoal));
  }

  function moveMoney(e, g, sign) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) { setError('Enter an amount greater than zero.'); return; }
    run(() => client.post(`/goals/${g.id}/contributions`, { amount: sign * value, date: localToday() }), () => setOpen(null));
  }

  function saveEdit(e, g) {
    e.preventDefault();
    run(() => client.put(`/goals/${g.id}`, { name: edit.name, target: Number(edit.target), targetDate: edit.targetDate || null }), () => setOpen(null));
  }

  function remove(g) {
    if (!confirm(`Delete the "${g.name}" goal and its history? The money itself isn’t touched.`)) return;
    run(() => client.delete(`/goals/${g.id}`));
  }

  if (!data) return <div className="empty-state">{error || 'Loading your goals…'}</div>;
  const active = data.goals.filter((g) => g.status !== 'reached');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Savings goals</h1>
          <div className="subtitle">What you’re saving for{activeProfile ? ` in ${activeProfile.name}` : ''}</div>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

      {data.goals.length > 0 && (
        <p className="budget-summary">
          <span><b>{money(data.totals.saved)}</b>saved toward {data.goals.length} goal{data.goals.length === 1 ? '' : 's'}</span>
          {active.some((g) => g.perMonth !== null) && (
            <span><b>{money(active.reduce((s, g) => s + (g.perMonth || 0), 0))}</b>a month keeps every dated goal on track</span>
          )}
        </p>
      )}

      {data.goals.length === 0 ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="empty-state">
            <h3>No goals yet</h3>
            <p>An emergency fund, a trip, a down payment: add one below and see how much to put aside each month.</p>
          </div>
        </div>
      ) : (
        <div className="goal-grid">
          {data.goals.map((g) => {
            const isOpen = open?.id === g.id;
            return (
              <div key={g.id} className={`card goal${g.status === 'reached' ? ' reached' : ''}`} style={{ '--cat': categoryColor(g.name) }}>
                <div className="goal-head">
                  <h2>{g.name}</h2>
                  {g.targetDate && <span className="goal-date">by {formatDate(g.targetDate)}</span>}
                </div>
                <div className="goal-figures">
                  <span><b>{money(g.saved)}</b> <span className="goal-of">of {money(g.target)}</span></span>
                  <span className="goal-pct">{g.percent}%</span>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={g.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name}: ${g.percent}% saved`}>
                  <span style={{ width: `${g.percent}%` }} />
                </div>
                <p className={`goal-status${g.status === 'overdue' ? ' warn-text' : ''}`}>{statusLine(g, money)}</p>

                <div className="budget-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => toggle(g, 'add')}>Add money</button>
                  {g.saved > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggle(g, 'take')}>Take out</button>}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggle(g, 'history')}>History</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggle(g, 'edit')}>Edit</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(g)}>Delete</button>
                </div>

                {isOpen && (open.mode === 'add' || open.mode === 'take') && (
                  <form className="budget-actions" onSubmit={(e) => moveMoney(e, g, open.mode === 'add' ? 1 : -1)}>
                    <input type="number" min="0.01" step="0.01" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)}
                           aria-label={open.mode === 'add' ? `Amount to add to ${g.name}` : `Amount to take out of ${g.name}`} placeholder="Amount" />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{open.mode === 'add' ? 'Add' : 'Take out'}</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>Cancel</button>
                  </form>
                )}

                {isOpen && open.mode === 'edit' && (
                  <form className="goal-edit" onSubmit={(e) => saveEdit(e, g)}>
                    <div className="form-field"><label htmlFor={`g-name-${g.id}`}>Name</label>
                      <input id={`g-name-${g.id}`} value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                    <div className="form-field"><label htmlFor={`g-target-${g.id}`}>Target</label>
                      <input id={`g-target-${g.id}`} type="number" min="0.01" step="0.01" value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} /></div>
                    <div className="form-field"><label htmlFor={`g-date-${g.id}`}>Target date (optional)</label>
                      <input id={`g-date-${g.id}`} type="date" value={edit.targetDate} onChange={(e) => setEdit({ ...edit, targetDate: e.target.value })} /></div>
                    <div className="budget-actions">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>Cancel</button>
                    </div>
                  </form>
                )}

                {isOpen && open.mode === 'history' && (
                  history.length === 0 ? <p className="fine-print">Nothing put in yet.</p> : (
                    <ul className="settle-list goal-history">
                      {history.map((c) => (
                        <li key={c.id}>
                          <span>{formatDate(c.date)}<span className="news-meta">{c.note || (c.amount > 0 ? 'Added' : 'Taken out')} · {c.addedBy}</span></span>
                          <span className={`delta ${c.amount > 0 ? 'up' : 'down'}`}>{formatMoney(c.amount, { signed: true, currency })}</span>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      <form className="card" onSubmit={addGoal}>
        <div className="card-title">Add a goal</div>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <div className="form-field" style={{ flex: '2 1 200px' }}>
            <label htmlFor="goal-name">What for</label>
            <input id="goal-name" value={form.name} maxLength={80} placeholder="e.g. Emergency fund" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-field" style={{ flex: '1 1 120px' }}>
            <label htmlFor="goal-target">Target</label>
            <input id="goal-target" type="number" min="0.01" step="0.01" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </div>
          <div className="form-field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="goal-date">By (optional)</label>
            <input id="goal-date" type="date" value={form.targetDate} min={localToday()} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
          </div>
          <div className="form-field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="goal-start">Already saved</label>
            <input id="goal-start" type="number" min="0" step="0.01" placeholder="0.00" value={form.startingAmount} onChange={(e) => setForm({ ...form, startingAmount: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>Add goal</button>
        </div>
        <p className="fine-print">Goals track money you’ve set aside. Moving the money itself still happens at your bank.</p>
      </form>
    </div>
  );
}
