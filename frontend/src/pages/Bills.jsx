import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import BillForm from '../components/BillForm.jsx';
import StatCard from '../components/StatCard.jsx';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate, localToday, daysBetween } from '../utils/format.js';
import { scanFileToDataUrl, SCAN_ACCEPT } from '../utils/scan.js';

const UPCOMING_WINDOW_DAYS = 30;

function dueLabel(dueOn, today) {
  const days = daysBetween(today, dueOn);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

export default function Bills() {
  const { activeProfileId, activeProfile } = useProfiles();
  const currency = activeProfile?.currency || 'USD';
  const [categories, setCategories] = useState([]);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // The add form opens either empty or with a draft from the scanner.
  const [draft, setDraft] = useState(null);
  const [scanNote, setScanNote] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState(null);
  // The bill whose "Mark paid" panel is open, and that panel's fields.
  const [paying, setPaying] = useState(null);
  const [payForm, setPayForm] = useState(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPaid, setShowPaid] = useState(false);
  const fileInputRef = useRef(null);

  const today = localToday();

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await client.get('/bills', { params: { profileId: activeProfileId } });
      setBills(data.bills);
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Could not load bills.');
    } finally {
      setLoading(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    client.get('/categories').then((res) => setCategories(res.data.categories));
  }, []);

  // Switching budgets closes anything open for the previous one.
  useEffect(() => {
    setDraft(null);
    setEditing(null);
    setPaying(null);
    setNotice('');
    load();
  }, [load]);

  const { overdue, upcoming, paid } = useMemo(() => {
    const unpaid = bills.filter((b) => !b.isPaid);
    return {
      overdue: unpaid.filter((b) => b.dueOn < today),
      upcoming: unpaid.filter((b) => b.dueOn >= today),
      // Most recent first - it's a history, unlike the to-do lists above.
      paid: bills.filter((b) => b.isPaid).reverse(),
    };
  }, [bills, today]);

  const overdueTotal = overdue.reduce((sum, b) => sum + b.amount, 0);
  const dueSoon = upcoming.filter((b) => daysBetween(today, b.dueOn) <= UPCOMING_WINDOW_DAYS);
  const dueSoonTotal = dueSoon.reduce((sum, b) => sum + b.amount, 0);

  function openAdd(initial = {}, note = null) {
    setEditing(null);
    setPaying(null);
    setNotice('');
    setDraft(initial);
    setScanNote(note);
  }

  // The scan only proposes a draft - it opens the add form pre-filled and
  // the user checks it and saves. Nothing is stored until they do.
  async function handleScan(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again after an error
    if (!file) return;
    setScanning(true);
    setNotice('');
    try {
      const image = await scanFileToDataUrl(file);
      const { data } = await client.post('/scan/receipt', { image });
      // A bill's amount due is what has to be paid; `amount` is only this
      // period's charges (what the transaction form records as spending).
      const amount = data.amountDue ?? data.amount;
      const found = [amount, data.dueDate, data.description].filter((v) => v !== null).length;
      if (found === 0) {
        openAdd({}, { text: "Couldn't read that document. Try a clearer, flatter photo, or enter the bill below.", isError: true });
        return;
      }
      const draftBill = {
        // Bill names are capped at 100 characters; the scanner allows longer.
        name: data.description !== null ? `${data.description.slice(0, 95)} bill` : '',
        amount,
        dueOn: data.dueDate ?? undefined,
        categoryId: data.categoryId,
      };
      const parts = [];
      if (data.kind !== 'bill') {
        parts.push("This looks like a receipt rather than a bill - if it's already paid, add it on the Transactions page instead.");
      } else if (found === 3) {
        parts.push('Filled in from your bill. Check it before saving.');
      } else {
        parts.push(data.dueDate
          ? 'Filled in what could be read from your bill. Check it and complete the rest.'
          : 'Filled in what could be read from your bill, but no due date was found. Check it and complete the rest.');
      }
      if (data.kind === 'bill' && data.amountDue !== null && data.amount !== null && data.amountDue > data.amount) {
        parts.push(`The amount due includes an earlier unpaid balance; this period's charges are ${formatMoney(data.amount, { currency })}.`);
      }
      openAdd(draftBill, { text: parts.join(' '), isError: data.kind !== 'bill' });
    } catch (err) {
      openAdd({}, { text: err.response?.data?.error || 'Could not scan this document. Enter the bill below.', isError: true });
    } finally {
      setScanning(false);
    }
  }

  async function handleAdd(payload) {
    await client.post('/bills', { ...payload, profileId: activeProfileId });
    setDraft(null);
    load();
  }

  async function handleEdit(payload) {
    await client.put(`/bills/${editing.id}`, payload);
    setEditing(null);
    load();
  }

  async function handleDelete(bill) {
    if (!confirm(`Delete "${bill.name}"? This cannot be undone.`)) return;
    await client.delete(`/bills/${bill.id}`);
    if (paying?.id === bill.id) setPaying(null);
    load();
  }

  function openPay(bill) {
    setDraft(null);
    setEditing(null);
    setNotice('');
    setPayError('');
    setPaying(bill);
    // Defaults to recording the payment as an expense today, for the full
    // amount, in the bill's category - each can be changed before saving.
    setPayForm({
      addExpense: true,
      amount: String(bill.amount),
      date: today,
      categoryId: bill.categoryId ? String(bill.categoryId) : '',
    });
  }

  async function handlePay(e) {
    e.preventDefault();
    setPayError('');
    let expense;
    if (payForm.addExpense) {
      const amountNum = Number(payForm.amount);
      if (!amountNum || amountNum <= 0) {
        setPayError('Enter an amount greater than zero.');
        return;
      }
      if (!payForm.date) {
        setPayError('Pick the date you paid it.');
        return;
      }
      expense = {
        amount: amountNum,
        date: payForm.date,
        description: paying.name,
        categoryId: payForm.categoryId ? Number(payForm.categoryId) : null,
      };
    }
    setPayBusy(true);
    try {
      await client.post(`/bills/${paying.id}/pay`, expense ? { expense } : {});
      setNotice(expense
        ? `${paying.name} marked paid and ${formatMoney(expense.amount, { currency })} added to your transactions.`
        : `${paying.name} marked paid.`);
      setPaying(null);
      load();
    } catch (err) {
      setPayError(err.response?.data?.error || 'Could not mark this bill paid.');
    } finally {
      setPayBusy(false);
    }
  }

  // Undo for a mistaken "Mark paid". The expense it may have created is a
  // normal transaction and stays - the notice says where to remove it.
  async function handleMarkUnpaid(bill) {
    await client.put(`/bills/${bill.id}`, { isPaid: false });
    setNotice(`${bill.name} marked unpaid. If an expense was recorded for it, delete it on the Transactions page.`);
    load();
  }

  const expenseCategories = categories.filter((c) => c.type === 'expense' || c.type === 'both');
  const formOpen = draft !== null || editing !== null;

  function renderRows(list) {
    return list.map((b) => (
      <Fragment key={b.id}>
        <tr>
          <td className="mono">{formatDate(b.dueOn)}</td>
          <td>{b.name}</td>
          <td>{b.categoryName && <span className="tag">{b.categoryName}</span>}</td>
          <td>{b.isRecurring && <span className="tag recurring">recurring</span>}</td>
          <td className="bill-status">
            {b.isPaid
              ? <span className="tag">Paid</span>
              : <span className={b.dueOn < today ? 'due overdue' : 'due'}>{dueLabel(b.dueOn, today)}</span>}
          </td>
          <td className="amount expense">{formatMoney(b.amount, { currency })}</td>
          <td>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {b.isPaid
                ? <button className="btn btn-secondary btn-sm" onClick={() => handleMarkUnpaid(b)}>Mark unpaid</button>
                : paying?.id !== b.id && <button className="btn btn-primary btn-sm" onClick={() => openPay(b)}>Mark paid</button>}
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(b); setDraft(null); setPaying(null); }}>Edit</button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(b)}>Delete</button>
            </div>
          </td>
        </tr>
        {paying?.id === b.id && (
          <tr className="pay-row">
            <td colSpan={7}>
              <form onSubmit={handlePay}>
                {payError && <div className="auth-error" style={{ marginBottom: 10 }}>{payError}</div>}
                <label className="checkbox-row" style={{ marginBottom: 10 }}>
                  <input type="checkbox" checked={payForm.addExpense}
                         onChange={(e) => setPayForm({ ...payForm, addExpense: e.target.checked })} />
                  Also record this payment as an expense in {activeProfile?.name || 'this budget'}
                </label>
                {payForm.addExpense && (
                  <div className="filter-bar" style={{ marginBottom: 10 }}>
                    <div className="form-field">
                      <label>Amount paid ({currency})</label>
                      <input type="number" min="0.01" step="0.01" value={payForm.amount}
                             onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required />
                    </div>
                    <div className="form-field">
                      <label>Paid on</label>
                      <input type="date" value={payForm.date}
                             onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} required />
                    </div>
                    <div className="form-field">
                      <label>Category</label>
                      <select value={payForm.categoryId} onChange={(e) => setPayForm({ ...payForm, categoryId: e.target.value })}>
                        <option value="">Uncategorized</option>
                        {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={payBusy}>
                    {payBusy ? 'Saving…' : payForm.addExpense ? 'Mark paid and add expense' : 'Mark paid'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaying(null)}>Cancel</button>
                </div>
              </form>
            </td>
          </tr>
        )}
      </Fragment>
    ));
  }

  function renderSection(title, list, emptyText) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          {title}
          <span style={{ fontWeight: 400, color: 'var(--ink-soft)', fontSize: 12 }}>{list.length}</span>
        </div>
        {list.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: 0 }}>{emptyText}</p>
        ) : (
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Due</th><th>Bill</th><th>Category</th><th>Recurring</th><th>Status</th>
                  <th style={{ textAlign: 'right' }}>Amount</th><th></th>
                </tr>
              </thead>
              <tbody>{renderRows(list)}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Bills</h1>
          <div className="subtitle">
            {overdue.length + upcoming.length} unpaid in {activeProfile?.name || 'this budget'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* No `capture` attribute, same as the transaction form: phones
              then offer both "Take photo" and "Choose file" (for PDFs). */}
          <input ref={fileInputRef} type="file" accept={SCAN_ACCEPT} onChange={handleScan} style={{ display: 'none' }} />
          <button className="btn btn-secondary" disabled={scanning} onClick={() => fileInputRef.current?.click()}>
            {scanning ? 'Reading…' : 'Scan bill'}
          </button>
          {!formOpen && (
            <button className="btn btn-primary" onClick={() => openAdd()}>Add bill</button>
          )}
        </div>
      </div>

      {notice && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{notice}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {draft !== null && (
        <BillForm categories={categories} currency={currency} initial={draft} isNew
                  note={scanNote?.text} noteIsError={scanNote?.isError}
                  onSubmit={handleAdd} onCancel={() => setDraft(null)} />
      )}
      {editing && (
        <BillForm categories={categories} currency={currency} initial={editing}
                  onSubmit={handleEdit} onCancel={() => setEditing(null)} />
      )}

      {loading ? (
        <div className="card"><div className="empty-state">Loading…</div></div>
      ) : loadError ? (
        <div className="card"><div className="empty-state">{loadError}</div></div>
      ) : bills.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No bills yet</h3>
            <p>Add one, or scan a bill or emailed PDF to fill it in for you.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Overdue" value={formatMoney(overdueTotal, { currency })}
                      tone={overdue.length > 0 ? 'negative' : undefined}
                      hint={`${overdue.length} bill${overdue.length === 1 ? '' : 's'}`} />
            <StatCard label={`Due in next ${UPCOMING_WINDOW_DAYS} days`} value={formatMoney(dueSoonTotal, { currency })}
                      hint={`${dueSoon.length} bill${dueSoon.length === 1 ? '' : 's'}`} />
          </div>

          {overdue.length > 0 && renderSection('Overdue', overdue)}
          {renderSection('Upcoming', upcoming, 'Nothing else due. Add a bill or scan one to keep track of it.')}

          {paid.length > 0 && (
            showPaid
              ? renderSection('Paid', paid)
              : (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowPaid(true)}>
                  Show {paid.length} paid bill{paid.length === 1 ? '' : 's'}
                </button>
              )
          )}
        </>
      )}
    </div>
  );
}
