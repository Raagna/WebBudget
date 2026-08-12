import { useState } from 'react';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatDate } from '../utils/format.js';

export default function Profiles() {
  const { profiles, activeProfileId, switchProfile, createProfile, renameProfile, deleteProfile } = useProfiles();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!newName.trim()) { setError('Give the new profile a name, e.g. "Household" or "Side business".'); return; }
    try {
      await createProfile(newName.trim());
      setNewName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create this profile.');
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditingName(p.name);
  }

  async function saveEdit(id) {
    if (!editingName.trim()) return;
    await renameProfile(id, editingName.trim());
    setEditingId(null);
  }

  async function handleDelete(p) {
    if (profiles.length <= 1) {
      setError('You need at least one profile — create another before deleting this one.');
      return;
    }
    if (!confirm(`Delete "${p.name}"? This permanently removes its ${p.transaction_count} transaction${p.transaction_count === 1 ? '' : 's'}. This cannot be undone.`)) return;
    await deleteProfile(p.id);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Profiles</h1>
          <div className="subtitle">Keep personal and household budgets separate — each profile has its own transactions and totals.</div>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <form className="card" onSubmit={handleCreate} style={{ marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label>New profile name</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Household, Side business, Vacation fund" />
        </div>
        <button className="btn btn-primary" type="submit">Create profile</button>
      </form>

      <div className="card">
        <table className="ledger">
          <thead>
            <tr><th>Name</th><th>Created</th><th>Transactions</th><th></th></tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td>
                  {editingId === p.id ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(p.id); if (e.key === 'Escape') setEditingId(null); }}
                      style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 3 }}
                    />
                  ) : (
                    <>
                      {p.name}
                      {p.id === activeProfileId && <span className="tag" style={{ marginLeft: 8 }}>Active</span>}
                    </>
                  )}
                </td>
                <td className="mono">{formatDate(p.created_at.slice(0, 10))}</td>
                <td className="mono">{p.transaction_count}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {editingId === p.id ? (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => saveEdit(p.id)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {p.id !== activeProfileId && (
                          <button className="btn btn-secondary btn-sm" onClick={() => switchProfile(p.id)}>Switch to</button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(p)}>Rename</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p)}>Delete</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
