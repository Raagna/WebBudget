import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { categoryColor } from '../utils/categoryColors.js';

const TYPE_LABEL = { expense: 'Spending', income: 'Income', both: 'Both' };

export default function Settings() {
  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    const [catRes, hiddenRes] = await Promise.all([
      client.get('/categories'),
      client.get('/categories/hidden'),
    ]);
    setCategories(catRes.data.categories);
    setHidden(hiddenRes.data.hidden);
  }

  useEffect(() => { load(); }, []);

  async function addCategory(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!name.trim()) { setError('Enter a category name.'); return; }
    try {
      await client.post('/categories', { name: name.trim(), type });
      setName('');
      setMessage('Category added.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add this category.');
    }
  }

  async function removeCategory(cat) {
    const isDefault = !!cat.is_default;
    const confirmMsg = isDefault
      ? `Hide "${cat.name}" from your category list? You can restore it any time below. This won't affect other accounts.`
      : `Remove "${cat.name}"? Existing transactions using it will show as Uncategorized instead.`;
    if (!confirm(confirmMsg)) return;
    await client.delete(`/categories/${cat.id}`);
    load();
  }

  async function restoreCategory(cat) {
    await client.post(`/categories/${cat.id}/restore`);
    load();
  }

  async function handleDeleteAccount(e) {
    e.preventDefault();
    setDeleteError('');
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    if (!confirm('Delete your account permanently? This cannot be undone.')) return;
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePassword);
      navigate('/login');
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Could not delete your account.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Account and category preferences</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Profile</div>
        {/* Shown as plain facts, not inputs: they can't be edited yet, so
            they shouldn't look editable. */}
        <dl className="facts">
          <div><dt>Name</dt><dd>{user?.name}</dd></div>
          <div><dt>Email</dt><dd>{user?.email}</dd></div>
        </dl>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '12px 0 0' }}>
          Your name and email can't be changed here yet.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Categories</div>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        {message && <div className="tag" style={{ marginBottom: 12 }}>{message}</div>}
        <form onSubmit={addCategory} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap' }}>
          <div className="form-field">
            <label htmlFor="new-category-name">Category name</label>
            <input id="new-category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet care" />
          </div>
          <div className="form-field">
            <label htmlFor="new-category-type">Used for</label>
            <select id="new-category-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="expense">{TYPE_LABEL.expense}</option>
              <option value="income">{TYPE_LABEL.income}</option>
              <option value="both">{TYPE_LABEL.both}</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Add category</button>
        </form>

        {categories.length === 0 ? (
          <div className="empty-state">No categories to show.</div>
        ) : (
          <table className="ledger stack">
            <thead><tr><th>Category</th><th>Used for</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  {/* The chip shows the category's colour, the same one it
                      has on every chart, strip and list in the app. */}
                  <td className="col-desc">
                    <span className="tag cat" style={{ '--cat': categoryColor(c.name) }}>{c.name}</span>
                    {!!c.is_default && <span className="default-note">Built in</span>}
                  </td>
                  <td className="col-date">{TYPE_LABEL[c.type] || c.type}</td>
                  <td className="col-actions" style={{ textAlign: 'right' }}><button className="btn btn-danger btn-sm" onClick={() => removeCategory(c)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {hidden.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Hidden default categories</div>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
            These are built-in categories you've hidden. Restoring one brings it back to your list above.
          </p>
          <table className="ledger stack">
            <thead><tr><th>Category</th><th>Used for</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {hidden.map((c) => (
                <tr key={c.id}>
                  <td className="col-desc"><span className="tag cat" style={{ '--cat': categoryColor(c.name) }}>{c.name}</span></td>
                  <td className="col-date">{TYPE_LABEL[c.type] || c.type}</td>
                  <td className="col-actions" style={{ textAlign: 'right' }}><button className="btn btn-secondary btn-sm" onClick={() => restoreCategory(c)}>Restore</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ borderColor: 'var(--brick)' }}>
        <div className="card-title" style={{ color: 'var(--brick)' }}>Danger zone</div>
        <p style={{ fontSize: 13, marginBottom: showDeleteForm ? 14 : 0 }}>
          Permanently delete your account, its custom categories, and every profile nobody else uses
          (along with their transactions and bills). Shared households stay, with everything you
          added to them, for the other members. If you're the only owner of one, promote another
          member to owner first.
        </p>
        {!showDeleteForm ? (
          <button className="btn btn-danger" onClick={() => setShowDeleteForm(true)}>Delete my account</button>
        ) : (
          <form onSubmit={handleDeleteAccount} style={{ marginTop: 4 }}>
            {deleteError && <div className="auth-error" style={{ marginBottom: 12 }}>{deleteError}</div>}
            <div className="form-field" style={{ maxWidth: 320, marginBottom: 12 }}>
              <label>Confirm your password</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-danger" type="submit" disabled={deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Permanently delete account'}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => { setShowDeleteForm(false); setDeletePassword(''); setDeleteError(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
