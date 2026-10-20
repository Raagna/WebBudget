import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate, localToday } from '../utils/format.js';
import Delta from '../components/Delta.jsx';

export const KIND_LABEL = {
  chequing: 'Chequing', savings: 'Savings', cash: 'Cash', property: 'Property or vehicle', other_asset: 'Other asset',
  credit_card: 'Credit card', loan: 'Loan', mortgage: 'Mortgage', other_debt: 'Other debt',
};
const ASSETS = ['chequing', 'savings', 'cash', 'property', 'other_asset'];
const DEBTS = ['credit_card', 'loan', 'mortgage', 'other_debt'];

const AXIS = { fontSize: 12, fill: '#4f5b55' };
const GRID = '#e3e8e3';
const monthShort = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

const emptyAccount = { name: '', kind: 'chequing', balance: '' };

export default function NetWorth() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyAccount);
  const [updating, setUpdating] = useState(null); // account id with its balance form open
  const [newBalance, setNewBalance] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await client.get('/networth', { params: { profileId: activeProfileId, today: localToday() } });
      setData(res.data);
      setError('');
    } catch {
      setError('Could not load your net worth right now.');
    }
  }, [activeProfileId]);

  useEffect(() => { setData(null); setUpdating(null); load(); }, [load]);

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

  if (!data) return <div className="empty-state">{error || 'Loading your net worth…'}</div>;

  const currency = data.currency || activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  const owned = data.accounts.filter((a) => !a.debt);
  const owed = data.accounts.filter((a) => a.debt);
  const nothingYet = data.accounts.length === 0 && data.investments === null;

  // A plain function, not a component: defined in here, a component would
  // be a new type on every render and its input would lose focus as you type.
  function accountRow(a) {
    const open = updating === a.id;
    return (
      <li key={a.id}>
        <div className="acct-row">
          <span>
            {a.name}
            <span className="news-meta">{KIND_LABEL[a.kind]}{a.asOf ? ` · as of ${formatDate(a.asOf)}` : ''}</span>
          </span>
          <span className="acct-balance">{a.balance === null ? '—' : money(a.balance)}</span>
        </div>
        {open ? (
          <form className="budget-actions" onSubmit={(e) => {
            e.preventDefault();
            run(() => client.post(`/networth/accounts/${a.id}/balances`, { balance: Number(newBalance), asOf: localToday() }), () => setUpdating(null));
          }}>
            <input type="number" step="0.01" autoFocus value={newBalance} onChange={(e) => setNewBalance(e.target.value)}
                   aria-label={a.debt ? `Amount owed on ${a.name} today` : `Balance of ${a.name} today`} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || newBalance === ''}>Save</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUpdating(null)}>Cancel</button>
          </form>
        ) : (
          <div className="budget-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setUpdating(a.id); setNewBalance(a.balance ?? ''); }}>Update balance</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => {
              if (confirm(`Remove ${a.name} and its balance history?`)) run(() => client.delete(`/networth/accounts/${a.id}`));
            }}>Remove</button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Net worth</h1>
          <div className="subtitle">What you own, minus what you owe{activeProfile ? `, in ${activeProfile.name}` : ''}</div>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

      {!nothingYet && (
        <p className="budget-summary">
          <span className={data.totals.netWorth < 0 ? 'over' : ''}>
            <b>{money(data.totals.netWorth)}</b>net worth
            {data.changeSinceLastMonth !== null && (
              <span className="change"><Delta value={data.changeSinceLastMonth} currency={currency} /> since the end of last month</span>
            )}
          </span>
          <span><b>{money(data.totals.assets)}</b>owned</span>
          <span><b>{money(data.totals.debts)}</b>owed</span>
        </p>
      )}

      {data.history.length > 1 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Over time</div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.history} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={monthShort} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => compact.format(v).replace(/^-/, '−')} />
              <Tooltip formatter={(v) => money(v)} labelFormatter={monthShort} contentStyle={{ fontSize: 13, borderRadius: 10, borderColor: '#d7ded7' }} />
              <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#1f6e46" fill="#1f6e46" fillOpacity={0.12} strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {nothingYet ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="empty-state">
            <h3>Add your first account</h3>
            <p>Add your bank accounts, cards and loans below with today’s balances. Update them every so often and this page charts your net worth over time.</p>
          </div>
        </div>
      ) : (
        <div className="debts-grid">
          <div className="card">
            <div className="card-title">What you own</div>
            <ul className="budget-list">
              {owned.map(accountRow)}
              {data.investments !== null && (
                <li>
                  <div className="acct-row">
                    <span>Investments<span className="news-meta">Live value of your holdings · <Link to="/investments">See holdings</Link></span></span>
                    <span className="acct-balance">{money(data.investments)}</span>
                  </div>
                </li>
              )}
            </ul>
            {owned.length === 0 && data.investments === null && <p className="fine-print" style={{ marginTop: 0 }}>Nothing yet.</p>}
          </div>
          <div className="card">
            <div className="card-title">What you owe</div>
            {owed.length === 0 ? <p className="fine-print" style={{ marginTop: 0 }}>No debts added. Credit cards, loans and a mortgage go here.</p> : (
              <ul className="budget-list">{owed.map(accountRow)}</ul>
            )}
          </div>
        </div>
      )}

      <form className="card" onSubmit={(e) => {
        e.preventDefault();
        run(() => client.post('/networth/accounts', {
          profileId: activeProfileId, name: form.name, kind: form.kind, balance: Number(form.balance), asOf: localToday(),
        }), () => setForm(emptyAccount));
      }}>
        <div className="card-title">Add an account</div>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <div className="form-field" style={{ flex: '2 1 200px' }}>
            <label htmlFor="acct-name">Name</label>
            <input id="acct-name" value={form.name} maxLength={80} placeholder="e.g. TD Chequing" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-field" style={{ flex: '1 1 170px' }}>
            <label htmlFor="acct-kind">Kind</label>
            <select id="acct-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <optgroup label="You own">{ASSETS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</optgroup>
              <optgroup label="You owe">{DEBTS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</optgroup>
            </select>
          </div>
          <div className="form-field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="acct-balance">{DEBTS.includes(form.kind) ? 'Amount owed today' : 'Balance today'}</label>
            <input id="acct-balance" type="number" step="0.01" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim() || form.balance === ''}>Add account</button>
        </div>
        <p className="fine-print">Balances are what you enter, not a bank connection. Update them whenever you check your accounts.</p>
      </form>
    </div>
  );
}
