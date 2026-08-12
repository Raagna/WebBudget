import { useEffect, useState, useCallback } from 'react';
import client from '../api/client';
import TransactionForm from '../components/TransactionForm.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

export default function Transactions({ type, title }) {
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [filters, setFilters] = useState({ categoryId: '', from: '', to: '', sort: 'occurred_on', dir: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    const params = { sort: filters.sort, dir: filters.dir, limit: 100 };
    if (type) params.type = type;
    if (filters.categoryId) params.categoryId = filters.categoryId;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    const { data } = await client.get('/transactions', { params });
    setTransactions(data.transactions);
    setTotal(data.total);
    setLoading(false);
  }, [type, filters]);

  useEffect(() => {
    client.get('/categories').then((res) => setCategories(res.data.categories));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(payload) {
    await client.post('/transactions', payload);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <div className="subtitle">{total} record{total === 1 ? '' : 's'}</div>
        </div>
        {!showForm && !editing && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add transaction</button>
        )}
      </div>

      {showForm && (
        <TransactionForm
          categories={categories}
          forcedType={type}
          onSubmit={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      )}
      {editing && (
        <TransactionForm
          categories={categories}
          forcedType={type}
          initial={editing}
          onSubmit={handleEdit}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="filter-bar">
        <div className="form-field">
          <label>Category</label>
          <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                <th>Date</th><th>Description</th><th>Category</th><th>Recurring</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
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
