import { useEffect, useRef, useState } from 'react';
import client from '../api/client.js';

const TODAY = new Date().toISOString().slice(0, 10);

// Phone photos are often 4000px+ and several MB. Receipt and bill text
// stays readable at 1600px (~145 dpi for a letter-size PDF page), and the
// smaller image uploads faster and fits the model's default context
// window, so shrink it in the browser before sending. Going bigger makes
// the request overflow that window - see the note in backend/routes/scan.js.
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

// Bills usually arrive as emailed PDFs. Render page 1 (where the amount
// due and due date live) to an image so the same scan route handles it.
// pdf.js is large, so it's only loaded the first time someone picks a PDF.
async function pdfFileToDataUrl(file) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: SCAN_MAX_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PDFs can have a transparent background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    pdf.destroy();
  }
}

function formatDueDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const image = isPdf ? await pdfFileToDataUrl(file) : await imageFileToDataUrl(file);
      const { data } = await client.post('/scan/receipt', { image });
      const found = [data.amount, data.date, data.description, data.categoryId].filter((v) => v !== null).length;
      if (found === 0) {
        setError("Couldn't read that document. Try a clearer, flatter photo, or enter it manually.");
        return;
      }
      const isBill = data.kind === 'bill';
      setForm((f) => ({
        ...f,
        type: 'expense',
        amount: data.amount !== null ? String(data.amount) : f.amount,
        date: data.date ?? f.date,
        description: data.description !== null ? (isBill ? `${data.description} bill` : data.description) : f.description,
        categoryId: data.categoryId !== null ? String(data.categoryId) : (f.type === 'expense' ? f.categoryId : ''),
      }));
      const source = isBill ? 'bill' : 'receipt';
      const due = isBill && data.dueDate ? ` Payment is due ${formatDueDate(data.dueDate)}.` : '';
      // The form records this period's charges; say so when the bill asks
      // for more because an earlier balance was carried over.
      const carried = isBill && data.amountDue !== null && data.amount !== null && data.amountDue > data.amount
        ? ` The bill's amount due is $${data.amountDue.toFixed(2)}, which includes an earlier unpaid balance.`
        : '';
      setScanNote((found === 4
        ? `Filled in from your ${source}. Check it before saving.`
        : `Filled in what could be read from your ${source}. Check it and complete the rest.`) + due + carried);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not scan this document. Enter the transaction manually.');
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
          {/* No `capture` attribute on purpose: it would force the camera
              on phones, making emailed PDF bills impossible to pick. Without
              it, phones offer both "Take photo" and "Choose file". */}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                 onChange={handleScan} style={{ display: 'none' }} />
          <button type="button" className="btn btn-secondary btn-sm" disabled={scanning || saving}
                  onClick={() => fileInputRef.current?.click()}>
            {scanning ? 'Reading…' : 'Scan receipt or bill'}
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
