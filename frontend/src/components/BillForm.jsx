import { useEffect, useState } from 'react';
import { localToday } from '../utils/format.js';

function mapFromBill(b) {
  return {
    name: b.name ?? '',
    amount: b.amount != null ? String(b.amount) : '',
    dueOn: b.dueOn ?? localToday(),
    categoryId: b.categoryId ? String(b.categoryId) : '',
    isRecurring: !!b.isRecurring,
  };
}

// Add/edit form for a bill. `initial` is either an existing bill (edit) or
// a draft from the scanner (new bill, pre-filled); `isNew` tells them apart.
// `note` and `noteIsError` carry the scanner's message about the draft.
export default function BillForm({ categories, currency, initial, isNew, note, noteIsError, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => mapFromBill(initial || {}));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(mapFromBill(initial || {})); }, [initial]);

  // Bills are always money going out.
  const expenseCategories = categories.filter((c) => c.type === 'expense' || c.type === 'both');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const amountNum = Number(form.amount);
    if (!form.name.trim()) {
      setError('Give the bill a name.');
      return;
    }
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!form.dueOn) {
      setError('Pick a due date.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        amount: amountNum,
        dueOn: form.dueOn,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        isRecurring: form.isRecurring,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this bill.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
      {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
      {note && (
        noteIsError
          ? <div className="auth-error" style={{ marginBottom: 12 }}>{note}</div>
          : <p style={{ color: 'var(--pine)', fontSize: 13, margin: '0 0 12px' }}>{note}</p>
      )}
      <div className="form-grid">
        <div className="form-field">
          <label>Name</label>
          <input value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })}
                 placeholder="e.g. Electric bill" required />
        </div>
        <div className="form-field">
          <label>Amount due ({currency})</label>
          <input type="number" min="0.01" step="0.01" value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </div>
        <div className="form-field">
          <label>Due date</label>
          <input type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} required />
        </div>
        <div className="form-field">
          <label>Category</label>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Uncategorized</option>
            {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-field" style={{ justifyContent: 'center' }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.isRecurring}
                   onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} />
            Recurring bill
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Add bill' : 'Save changes'}
        </button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
