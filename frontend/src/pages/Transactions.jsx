import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import client from '../api/client';
import TransactionForm from '../components/TransactionForm.jsx';
import { useProfiles } from '../context/ProfileContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { categoryColor } from '../utils/categoryColors.js';
import { formatMoney, formatDate, localToday } from '../utils/format.js';

export default function Transactions() {
  const { activeProfileId, activeProfile } = useProfiles();
  const { user } = useAuth();
  // In a shared household, show who added each transaction and let the
  // list be filtered to one member.
  const isShared = (activeProfile?.member_count || 0) > 1;
  const [members, setMembers] = useState([]);
  const currency = activeProfile?.currency || 'USD';
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // The dashboard's "Add or scan" button links here with ?add=1.
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(() => searchParams.get('add') === '1');
  useEffect(() => {
    if (searchParams.get('add') === '1') {
      setShowForm(true);
      setSearchParams({}, { replace: true }); // so a refresh doesn't reopen it
    }
  }, [searchParams, setSearchParams]);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);
  // Remembers the row index of the last checkbox click, so a shift+click
  // elsewhere in the list knows what range to select. Doesn't need to
  // trigger a re-render on its own, hence a ref rather than state.
  const lastCheckedIndexRef = useRef(null);

  // "type" is now a filter/sort dimension rather than a separate page -
  // All / Income / Expense, applied the same way as category or date.
  const [filters, setFilters] = useState({ type: '', categoryId: '', addedBy: '', from: '', to: '', sort: 'occurred_on', dir: 'desc' });
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = ['type', 'categoryId', 'addedBy', 'from', 'to'].filter((k) => filters[k]).length;

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    setLoading(true);
    const params = { profileId: activeProfileId, sort: filters.sort, dir: filters.dir, limit: 100 };
    if (filters.type) params.type = filters.type;
    if (filters.categoryId) params.categoryId = filters.categoryId;
    if (filters.addedBy) params.addedBy = filters.addedBy;
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

  useEffect(() => {
    setFilters((f) => (f.addedBy ? { ...f, addedBy: '' } : f)); // a member of another household
    if (!isShared) { setMembers([]); return; }
    client.get(`/profiles/${activeProfileId}/members`)
      .then((res) => setMembers(res.data.members.filter((m) => m.status === 'active')))
      .catch(() => setMembers([]));
  }, [activeProfileId, isShared]);

  const addedByLabel = (t) => (!t.addedBy ? 'Former member' : t.addedBy.id === user?.id ? 'You' : t.addedBy.name);

  // Export respects whatever filters are currently applied (type,
  // category, date range) - clear filters first to export everything, or
  // filter down to export just a subset. Needs to go through axios (not a
  // plain link) since the endpoint requires the auth header; a blob
  // response plus a throwaway anchor is the standard way to trigger a
  // file download from an authenticated API call.
  async function handleExport() {
    setExportBusy(true);
    try {
      const params = { profileId: activeProfileId };
      if (filters.type) params.type = filters.type;
      if (filters.categoryId) params.categoryId = filters.categoryId;
    if (filters.addedBy) params.addedBy = filters.addedBy;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const res = await client.get('/transactions/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${localToday()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const { data } = await client.post('/transactions/import', { profileId: activeProfileId, csv: text });
      setImportResult(data);
      load();
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Could not import this file.' });
    } finally {
      setImportBusy(false);
    }
  }

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

  function toggleOne(id, index, shiftKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift+click selects every row between the last-clicked checkbox
      // and this one, inclusive - same convention as Gmail/file explorers.
      // Falls back to a normal single toggle if there's no prior click to
      // anchor a range to yet.
      if (shiftKey && lastCheckedIndexRef.current !== null) {
        const start = Math.min(lastCheckedIndexRef.current, index);
        const end = Math.max(lastCheckedIndexRef.current, index);
        for (let i = start; i <= end; i++) {
          next.add(transactions[i].id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastCheckedIndexRef.current = index;
  }

  function selectAll() {
    setSelected(new Set(transactions.map((t) => t.id)));
    lastCheckedIndexRef.current = null;
  }

  function toggleAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      selectAll();
    }
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
        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
          <button
            className="btn btn-secondary"
            onClick={triggerImport}
            disabled={importBusy}
            title="This app's CSV export, or a TD EasyWeb download (accountactivity.csv). Rows already imported are skipped."
          >
            {importBusy ? 'Importing…' : 'Import CSV'}
          </button>
          <button className="btn btn-secondary" onClick={handleExport} disabled={exportBusy || total === 0}>
            {exportBusy ? 'Exporting…' : 'Export CSV'}
          </button>
          {!showForm && !editing && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add transaction</button>
          )}
        </div>
      </div>

      {importResult && (
        <div className="card" style={{ marginBottom: 20, borderColor: importResult.error ? 'var(--brick)' : 'var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              {importResult.error ? (
                <p style={{ color: 'var(--brick)', margin: 0 }}>{importResult.error}</p>
              ) : (
                <>
                  <p style={{ margin: 0 }}>
                    Imported <strong>{importResult.imported}</strong> of {importResult.totalRows} row{importResult.totalRows === 1 ? '' : 's'}
                    {importResult.format === 'td' && ' from a TD bank file'}.
                    {importResult.duplicates > 0 && ` ${importResult.duplicates} skipped as already imported.`}
                    {importResult.autoCategorized > 0 && ` ${importResult.autoCategorized} auto-categorized${importResult.lookedUp > 0 ? ` (${importResult.lookedUp} looked up by the local model)` : ''}.`}
                    {importResult.recurring > 0 && ` ${importResult.recurring} marked recurring.`}
                    {importResult.categorizedExisting > 0 && ` Filled in the category on ${importResult.categorizedExisting} earlier row${importResult.categorizedExisting === 1 ? '' : 's'}.`}
                    {importResult.recurringExisting > 0 && ` Marked ${importResult.recurringExisting} earlier row${importResult.recurringExisting === 1 ? '' : 's'} recurring.`}
                    {importResult.warnings.length > 0 && ` ${importResult.warnings.length} warning${importResult.warnings.length === 1 ? '' : 's'}.`}
                    {importResult.errors.length > 0 && ` ${importResult.errors.length} skipped with errors.`}
                  </p>
                  {(importResult.warnings.length > 0 || importResult.errors.length > 0) && (
                    <ul style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, paddingLeft: 18 }}>
                      {importResult.errors.map((e, i) => <li key={`e${i}`}>Row {e.row}: {e.reason}</li>)}
                      {importResult.warnings.map((w, i) => <li key={`w${i}`}>Row {w.row}: {w.reason}</li>)}
                    </ul>
                  )}
                </>
              )}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setImportResult(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {showForm && (
        <TransactionForm categories={categories} onSubmit={handleAdd} onCancel={() => setShowForm(false)} />
      )}
      {editing && (
        <TransactionForm categories={categories} initial={editing} onSubmit={handleEdit} onCancel={() => setEditing(null)} />
      )}

      {/* On phones the filters fold away behind this button so the list
          itself is on screen; on desktop the button is hidden and the
          filters always show. */}
      <button
        type="button"
        className="btn btn-secondary btn-sm filters-toggle"
        aria-expanded={showFilters}
        aria-controls="tx-filters"
        onClick={() => setShowFilters((v) => !v)}
      >
        {showFilters ? 'Hide filters' : `Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
      </button>
      <div id="tx-filters" className={`filter-bar tx-filters${showFilters ? ' open' : ''}`}>
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
        {isShared && (
          <div className="form-field">
            <label htmlFor="filter-added-by">Added by</label>
            <select id="filter-added-by" value={filters.addedBy} onChange={(e) => setFilters({ ...filters, addedBy: e.target.value })}>
              <option value="">Everyone</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === user?.id ? 'You' : m.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-field">
          <label>From</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div className="form-field">
          <label>To</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div className="form-field">
          <label htmlFor="tx-sort">Sort</label>
          {/* Column and direction in one plain-language choice. */}
          <select
            id="tx-sort"
            value={`${filters.sort}:${filters.dir}`}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(':');
              setFilters({ ...filters, sort, dir });
            }}
          >
            <option value="occurred_on:desc">Newest first</option>
            <option value="occurred_on:asc">Oldest first</option>
            <option value="amount_cents:desc">Largest amount</option>
            <option value="amount_cents:asc">Smallest amount</option>
            <option value="description:asc">Description A–Z</option>
            <option value="type:desc">Income first</option>
            <option value="type:asc">Spending first</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk-toolbar">
          <span className="count">{selected.size} selected</span>
          {selected.size < transactions.length && (
            <button className="btn btn-secondary btn-sm" onClick={selectAll}>Select all {transactions.length}</button>
          )}
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

      {selected.size === 0 && transactions.length > 0 && (
        <div className="select-hint">
          <button className="btn btn-secondary btn-sm" onClick={selectAll}>Select all {transactions.length}</button>
          <span>Tip: hold Shift and click a checkbox to select everything in between.</span>
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
          <table className="ledger stack">
            <thead>
              <tr>
                <th className="select-col"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                <th>Date</th><th>Description</th><th>Category</th><th>Recurring</th>
                {isShared && <th>Added by</th>}
                <th style={{ textAlign: 'right' }}>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, idx) => (
                <tr key={t.id}>
                  <td className="select-col">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={(e) => toggleOne(t.id, idx, e.nativeEvent.shiftKey)}
                      aria-label={`Select ${t.description}`}
                    />
                  </td>
                  <td className="mono col-date">{formatDate(t.date)}</td>
                  <td className="col-desc">{t.description}</td>
                  <td className="col-cat">{t.categoryName && <span className="tag cat" style={{ '--cat': categoryColor(t.categoryName) }}>{t.categoryName}</span>}</td>
                  <td className="col-rec">{t.isRecurring && <span className="tag recurring">{t.recurringInterval}</span>}</td>
                  {isShared && <td className="col-by">{addedByLabel(t)}</td>}
                  <td className={`amount col-amount ${t.type}`}>{t.type === 'income' ? '+' : '−'}{formatMoney(t.amount, { currency })}</td>
                  <td className="col-actions">
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
