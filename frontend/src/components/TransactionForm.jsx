import { useEffect, useState } from 'react';

const TODAY = new Date().toISOString().slice(0, 10);

const emptyForm = {
  amount: '', type: 'expense', description: '', date: TODAY,
  categoryId: '', isRecurring: false, recurringInterval: 'monthly',
};

export default function TransactionForm({ categories, initial, onSubmit, onCancel, forcedType }) {
  const [form, setForm] = useState(initial ? mapFromTransaction(initial) : { ...emptyForm, type: forcedType || 'expense' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) setForm(mapFromTransaction(initial));
  }, [initial]);

  function mapFromTransaction(t) {
    return {
      amount: String(t.amount),
      type: t.type,
      description: t.description,
      date: t.date,
      categoryId: t.categoryId || '',
      isRecurring: t.isRecurring,
      recurringInterval: t.recurringInterval || 'monthly',
    };
  }

  const filteredCategories = categories.filter((c) => c.type === 'both' || c.type === form.type);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const amountNum = Number(form.amount);
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!form.description.trim()) {
      setError('Add a short description.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        amount: amountNum,
        type: form.type,
        description: form.description.trim(),
        date: form.date,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        isRecurring: form.isRecurring,
        recurringInterval: form.isRecurring ? form.recurringInterval : null,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this transaction.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
      {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="form-grid">
        {!forcedType && (
          <div className="form-field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, categoryId: '' })}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
        )}
        <div className="form-field">
          <label>Amount ($)</label>
          <input type="number" min="0.01" step="0.01" value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </div>
        <div className="form-field">
          <label>Date</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div className="form-field">
          <label>Category</label>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Uncategorized</option>
            {filteredCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-field" style={{ gridColumn: forcedType ? 'span 2' : 'auto' }}>
          <label>Description</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                 placeholder="e.g. Weekly groceries" required />
        </div>
        <div className="form-field" style={{ justifyContent: 'center' }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.isRecurring}
                   onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} />
            Recurring
          </label>
          {form.isRecurring && (
            <select value={form.recurringInterval} onChange={(e) => setForm({ ...form, recurringInterval: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add transaction'}
        </button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
