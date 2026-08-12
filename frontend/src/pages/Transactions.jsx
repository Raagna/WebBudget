import { useEffect, useState, useCallback, useMemo } from 'react';
import client from '../api/client';
import TransactionForm from '../components/TransactionForm.jsx';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

export default function Transactions() {
  const { activeProfileId } = useProfiles();
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // "type" is now a filter/sort dimension rather than a separate page -
  // All / Income / Expense, applied the same way as category or date.
  const [filters, setFilters] = useState({ type: '', categoryId: '', from: '', to: '', sort: 'occurred_on', dir: 'desc' });

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    setLoading(true);
    const params = { profileId: activeProfileId, sort: filters.sort, dir: filters.dir, limit: 100 };
    if (filters.type) params.type = filters.type;
    if (filters.categoryId) params.categoryId = filters.categoryId;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    const { data } = await client.get('/transactions', { params });
    setTransactions(data.transactions);
    setTotal(data.total);
    setSelected(new Set());
    setLoading(false);
  }, [activeProfileId, filters]);

  useEffect(() => {
    client.get('/categories').then((res) => setCategories(res.data.categories));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(payload) {
    await client.post('/transactions', { ...payload, profileId: activeProfileId });
    setShowForm(false);
    load();
  }

  async function handleEdit(payload) {
    await client.put(`/transactions/${editing.id}`, payload);
    setEditing(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    await client.delete(`/transactions/${id}`);
    load();
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === transactions.length ? new Set() : new Set(transactions.map((t) => t.id))));
  }

  const allSelected = transactions.length > 0 && selected.size === transactions.length;

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selected.size} selected transaction${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      await client.post('/transactions/bulk-delete', { ids: [...selected] });
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkCategoryApply() {
    if (!bulkCategoryId) return;
    setBulkBusy(true);
    try {
      await client.patch('/transactions/bulk-update', {
        ids: [...selected],
        categoryId: bulkCategoryId === 'uncategorized' ? null : Number(bulkCategoryId),
      });
      setBulkCategoryId('');
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  const typeFilteredCategories = useMemo(
    () => categories.filter((c) => !filters.type || c.type === 'both' || c.type === filters.type),
    [categories, filters.type]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <div className="subtitle">{total} record{total === 1 ? '' : 's'}</div>
        </div>
        {!showForm && !editing && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add transaction</button>
        )}
      </div>

      {showForm && (
        <TransactionForm categories={categories} onSubmit={handleAdd} onCancel={() => setShowForm(false)} />
      )}
      {editing && (
        <TransactionForm categories={categories} initial={editing} onSubmit={handleEdit} onCancel={() => setEditing(null)} />
      )}

      <div className="filter-bar">
        <div className="form-field">
          <label>Type</label>
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, categoryId: '' })}>
            <option value="">All</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
        <div className="form-field">
          <label>Category</label>
          <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
            <option value="">All categories</option>
            {typeFilteredCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>From</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div className="form-field">
          <label>To</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div className="form-field">
          <label>Sort by</label>
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
            <option value="occurred_on">Date</option>
            <option value="amount_cents">Amount</option>
            <option value="description">Description</option>
            <option value="type">Type</option>
          </select>
        </div>
        <div className="form-field">
          <label>Direction</label>
          <select value={filters.dir} onChange={(e) => setFilters({ ...filters, dir: e.target.value })}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk-toolbar">
          <span className="count">{selected.size} selected</span>
          <div className="bulk-edit-row">
            <select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}>
              <option value="">Set category…</option>
              <option value="uncategorized">Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm" disabled={!bulkCategoryId || bulkBusy} onClick={handleBulkCategoryApply}>
              Apply
            </button>
          </div>
          <div className="spacer" />
          <button className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={handleBulkDelete}>
            Delete selected
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <h3>No transactions found</h3>
            <p>Try adjusting your filters, or add a new transaction above.</p>
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th className="select-col"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                <th>Date</th><th>Description</th><th>Category</th><th>Recurring</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="select-col">
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} aria-label={`Select ${t.description}`} />
                  </td>
                  <td className="mono">{formatDate(t.date)}</td>
                  <td>{t.description}</td>
                  <td>{t.categoryName && <span className="tag">{t.categoryName}</span>}</td>
                  <td>{t.isRecurring && <span className="tag recurring">{t.recurringInterval}</span>}</td>
                  <td className={`amount ${t.type}`}>{t.type === 'income' ? '+' : '-'}{formatMoney(t.amount)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(t); setShowForm(false); }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>Delete</button>
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
