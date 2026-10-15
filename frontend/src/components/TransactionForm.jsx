import { useEffect, useRef, useState } from 'react';
import client from '../api/client.js';

const TODAY = new Date().toISOString().slice(0, 10);

// Phone photos are often 4000px+ and several MB. Receipt text stays
// readable at 1600px, and the smaller image uploads faster and is read
// faster by the model, so shrink it in the browser before sending.
const SCAN_MAX_SIDE = 1600;

async function imageFileToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SCAN_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

const emptyForm = {
  amount: '', type: 'expense', description: '', date: TODAY,
  categoryId: '', isRecurring: false, recurringInterval: 'monthly',
};

export default function TransactionForm({ categories, initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial ? mapFromTransaction(initial) : emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const fileInputRef = useRef(null);

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

  // The scan only proposes values - it fills the form and the user reviews
  // and saves as usual. Fields the model couldn't read keep what's there.
  async function handleScan(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again after an error
    if (!file) return;
    setError('');
    setScanNote('');
    setScanning(true);
    try {
      const image = await imageFileToDataUrl(file);
      const { data } = await client.post('/scan/receipt', { image });
      const found = [data.amount, data.date, data.description, data.categoryId].filter((v) => v !== null).length;
      if (found === 0) {
        setError("Couldn't read that receipt. Try a clearer, flatter photo, or enter it manually.");
        return;
      }
      setForm((f) => ({
        ...f,
        type: 'expense',
        amount: data.amount !== null ? String(data.amount) : f.amount,
        date: data.date ?? f.date,
        description: data.description ?? f.description,
        categoryId: data.categoryId !== null ? String(data.categoryId) : (f.type === 'expense' ? f.categoryId : ''),
      }));
      setScanNote(found === 4
        ? 'Filled in from your receipt. Check it before saving.'
        : 'Filled in what could be read from your receipt. Check it and complete the rest.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not scan this receipt. Enter the transaction manually.');
    } finally {
      setScanning(false);
    }
  }

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
      {!initial && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {/* capture="environment" opens the rear camera on phones; on a
              desktop it falls back to a normal file picker. */}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                 onChange={handleScan} style={{ display: 'none' }} />
          <button type="button" className="btn btn-secondary btn-sm" disabled={scanning || saving}
                  onClick={() => fileInputRef.current?.click()}>
            {scanning ? 'Reading receipt…' : 'Scan receipt'}
          </button>
          {scanNote && <span style={{ color: 'var(--pine)', fontSize: 13 }}>{scanNote}</span>}
        </div>
      )}
      <div className="form-grid">
        <div className="form-field">
          <label>Type</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, categoryId: '' })}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
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
        <div className="form-field">
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
        <button type="submit" className="btn btn-primary" disabled={saving || scanning}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add transaction'}
        </button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
