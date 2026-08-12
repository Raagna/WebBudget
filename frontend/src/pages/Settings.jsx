import { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';

export default function Settings() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const { data } = await client.get('/categories');
    setCategories(data.categories);
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

  async function removeCategory(id) {
    if (!confirm('Remove this custom category?')) return;
    await client.delete(`/categories/${id}`);
    load();
  }

  const custom = categories.filter((c) => !c.is_default);

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
        <div className="form-grid">
          <div className="form-field"><label>Name</label><input value={user?.name || ''} disabled /></div>
          <div className="form-field"><label>Email</label><input value={user?.email || ''} disabled /></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 12 }}>
          Profile editing isn't wired up in this starter — add a PATCH /api/users/me endpoint to support it.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Custom categories</div>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        {message && <div className="tag" style={{ marginBottom: 12 }}>{message}</div>}
        <form onSubmit={addCategory} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap' }}>
          <div className="form-field">
            <label>Category name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet care" />
          </div>
          <div className="form-field">
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="both">Both</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Add category</button>
        </form>

        {custom.length === 0 ? (
          <div className="empty-state">No custom categories yet — the defaults cover most everyday spending.</div>
        ) : (
          <table className="ledger">
            <thead><tr><th>Name</th><th>Type</th><th></th></tr></thead>
            <tbody>
              {custom.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{c.type}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => removeCategory(c.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
