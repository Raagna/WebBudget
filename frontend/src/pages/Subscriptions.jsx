import { useEffect, useState } from 'react';
import client from '../api/client';
import { formatMoney, formatDate } from '../utils/format.js';

const emptyForm = { name: '', amount: '', billingCycle: 'monthly', nextBillingOn: new Date().toISOString().slice(0, 10) };

export default function Subscriptions() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await client.get('/subscriptions');
    setItems(data.subscriptions);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !(Number(form.amount) > 0)) {
      setError('Enter a name and an amount greater than zero.');
      return;
    }
    try {
      await client.post('/subscriptions', { ...form, amount: Number(form.amount) });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this subscription.');
    }
  }

  async function toggleActive(sub) {
    await client.put(`/subscriptions/${sub.id}`, { isActive: !sub.isActive });
    load();
  }

  async function remove(id) {
    if (!confirm('Cancel and remove this subscription?')) return;
    await client.delete(`/subscriptions/${id}`);
    load();
  }

  const activeTotal = items.filter((s) => s.isActive).reduce((sum, s) => sum + s.amount, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Subscriptions</h1>
          <div className="subtitle">{items.filter((s) => s.isActive).length} active · {formatMoney(activeTotal)} / month</div>
        </div>
        {!showForm && <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add subscription</button>}
      </div>

      {showForm && (
        <form className="card" onSubmit={handleAdd} style={{ marginBottom: 20 }}>
          {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Netflix" required />
            </div>
            <div className="form-field">
              <label>Amount ($)</label>
              <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="form-field">
              <label>Billing cycle</label>
              <select value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="form-field">
              <label>Next billing date</label>
              <input type="date" value={form.nextBillingOn} onChange={(e) => setForm({ ...form, nextBillingOn: e.target.value })} required />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">Add subscription</button>
            <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state"><h3>No subscriptions yet</h3><p>Add one to start tracking recurring charges.</p></div>
        ) : (
          <table className="ledger">
            <thead><tr><th>Name</th><th>Cycle</th><th>Next billing</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.billingCycle}</td>
                  <td className="mono">{formatDate(s.nextBillingOn)}</td>
                  <td><span className="tag" style={!s.isActive ? { background: '#f3e4de', color: '#a6432d' } : undefined}>{s.isActive ? 'Active' : 'Paused'}</span></td>
                  <td className="amount expense">{formatMoney(s.amount)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(s)}>{s.isActive ? 'Pause' : 'Resume'}</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>Remove</button>
                    </div>
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
