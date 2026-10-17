import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, localToday } from '../utils/format.js';
import BudgetBar from '../components/BudgetBar.jsx';

// Compares how much of the budget is used with how much of the month has
// passed, so "60% used" means something: fine on the 25th, a warning on the 5th.
function paceNote(budget, daysLeft, daysInMonth) {
  if (!daysLeft || budget.percent > 100) return null;
  const monthPassed = Math.round(((daysInMonth - daysLeft + 1) / daysInMonth) * 100);
  if (budget.percent > monthPassed + 10) return 'Spending faster than the month is passing';
  return null;
}

export default function Budgets() {
  const { activeProfileId, activeProfile } = useProfiles();
  const currency = activeProfile?.currency || 'USD';
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // categoryId whose amount is being edited
  const [editAmount, setEditAmount] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const [budgetsRes, categoriesRes] = await Promise.all([
        client.get('/budgets', { params: { profileId: activeProfileId, today: localToday() } }),
        client.get('/categories'),
      ]);
      setData(budgetsRes.data);
      setCategories(categoriesRes.data.categories.filter((c) => c.type !== 'income'));
      setError('');
    } catch {
      setError('Could not load your budgets right now.');
    }
  }, [activeProfileId]);

  useEffect(() => { setData(null); setEditing(null); load(); }, [load]);

  async function save(categoryId, amountText) {
    const amount = Number(amountText);
    if (!amount || amount <= 0) {
      setError('Enter a monthly amount greater than zero.');
      return false;
    }
    setSaving(true);
    try {
      await client.put('/budgets', { profileId: activeProfileId, categoryId: Number(categoryId), amount });
      await load();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this budget.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newCategory) { setError('Pick a category.'); return; }
    if (await save(newCategory, newAmount)) { setNewCategory(''); setNewAmount(''); }
  }

  async function handleRemove(budget) {
    if (!confirm(`Remove the ${budget.categoryName} budget?`)) return;
    try {
      await client.delete(`/budgets/${budget.id}`);
      await load();
    } catch {
      setError('Could not remove this budget.');
    }
  }

  if (!data) return <div className="empty-state">{error || 'Loading your budgets…'}</div>;

  const budgeted = new Set(data.budgets.map((b) => b.categoryId));
  const available = categories.filter((c) => !budgeted.has(c.id));
  const [y, m] = data.month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const { totals } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Budgets</h1>
          <div className="subtitle">
            Monthly spending limits per category{activeProfile ? ` for ${activeProfile.name}` : ''}
            {data.daysLeft > 0 && ` · ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'} left this month`}
          </div>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

      {data.budgets.length > 0 && (
        <div className="stat-grid">
          <div className="card stat-card">
            <div className="label">Budgeted</div>
            <div className="value">{formatMoney(totals.budgeted, { currency })}</div>
          </div>
          <div className="card stat-card">
            <div className="label">Spent in budgets</div>
            <div className="value negative">{formatMoney(totals.spent, { currency })}</div>
          </div>
          <div className="card stat-card">
            <div className="label">Left in budgets</div>
            <div className="value positive">{formatMoney(totals.remaining, { currency })}</div>
            {totals.unbudgetedSpent > 0 && (
              <div className="hint">Plus {formatMoney(totals.unbudgetedSpent, { currency })} spent outside any budget</div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">This month</div>
        {data.budgets.length === 0 ? (
          <div className="empty-state">
            <h3>No budgets yet</h3>
            <p>Pick a category below and set how much you want to spend on it each month.</p>
          </div>
        ) : (
          <ul className="budget-list">
            {data.budgets.map((b) => (
              <li key={b.id}>
                <BudgetBar budget={b} currency={currency} />
                {paceNote(b, data.daysLeft, daysInMonth) && (
                  <div className="budget-pace">{paceNote(b, data.daysLeft, daysInMonth)}</div>
                )}
                {editing === b.categoryId ? (
                  <form className="budget-actions" onSubmit={async (e) => {
                    e.preventDefault();
                    if (await save(b.categoryId, editAmount)) setEditing(null);
                  }}>
                    <input type="number" min="0.01" step="0.01" value={editAmount} autoFocus
                           aria-label={`Monthly budget for ${b.categoryName}`}
                           onChange={(e) => setEditAmount(e.target.value)} />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <div className="budget-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(b.categoryId); setEditAmount(String(b.amount)); }}>
                      Change amount
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleRemove(b)}>Remove</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="card" onSubmit={handleAdd}>
        <div className="card-title">Add a budget</div>
        {available.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>Every spending category already has a budget.</p>
        ) : (
          <div className="filter-bar" style={{ marginBottom: 0 }}>
            <div className="form-field">
              <label htmlFor="budget-category">Category</label>
              <select id="budget-category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                <option value="">Choose…</option>
                {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="budget-amount">Per month</label>
              <input id="budget-amount" type="number" min="0.01" step="0.01" placeholder="e.g. 400"
                     value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>Add budget</button>
          </div>
        )}
      </form>
    </div>
  );
}
