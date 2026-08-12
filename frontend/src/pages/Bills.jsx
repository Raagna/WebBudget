import { useEffect, useState } from 'react';
import client from '../api/client';
import { formatMoney, formatDate } from '../utils/format.js';

const emptyForm = { name: '', amount: '', dueOn: new Date().toISOString().slice(0, 10), isRecurring: false };

export default function Bills() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await client.get('/bills');
    setItems(data.bills);
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
      await client.post('/bills', { ...form, amount: Number(form.amount) });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this bill.');
    }
  }

  async function togglePaid(bill) {
    await client.put(`/bills/${bill.id}`, { isPaid: !bill.isPaid });
    load();
  }

  async function remove(id) {
    if (!confirm('Remove this bill?')) return;
    await client.delete(`/bills/${id}`);
    load();
  }

  const unpaid = items.filter((b) => !b.isPaid);
  const unpaidTotal = unpaid.reduce((sum, b) => sum + b.amount, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Bills</h1>
          <div className="subtitle">{unpaid.length} unpaid · {formatMoney(unpaidTotal)} due</div>
        </div>
        {!showForm && <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add bill</button>}
      </div>

      {showForm && (
        <form className="card" onSubmit={handleAdd} style={{ marginBottom: 20 }}>
          {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Electric bill" required />
            </div>
            <div className="form-field">
              <label>Amount ($)</label>
              <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="form-field">
              <label>Due date</label>
              <input type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} required />
            </div>
            <div className="form-field" style={{ justifyContent: 'center' }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} />
                Recurring bill
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">Add bill</button>
            <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state"><h3>No bills yet</h3><p>Add one to keep track of what's due.</p></div>
        ) : (
          <table className="ledger">
            <thead><tr><th>Name</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}{b.isRecurring && <span className="tag recurring" style={{ marginLeft: 8 }}>recurring</span>}</td>
                  <td className="mono">{formatDate(b.dueOn)}</td>
                  <td><span className="tag" style={b.isPaid ? undefined : { background: '#f1e8d3', color: '#b8933a' }}>{b.isPaid ? 'Paid' : 'Unpaid'}</span></td>
                  <td className="amount expense">{formatMoney(b.amount)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => togglePaid(b)}>{b.isPaid ? 'Mark unpaid' : 'Mark paid'}</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>Remove</button>
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
