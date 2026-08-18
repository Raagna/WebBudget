import { useState, useEffect, useCallback } from 'react';
import { useProfiles } from '../context/ProfileContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate } from '../utils/format.js';
import { CURRENCIES } from '../utils/currencies.js';

export default function Profiles() {
  const { user } = useAuth();
  const {
    profiles, activeProfileId, switchProfile, createProfile, renameProfile,
    updateProfileCurrency, deleteProfile,
    inviteMember, getMembers, removeMember, promoteMember, demoteMember,
    getInvites, acceptInvite, declineInvite,
  } = useProfiles();

  const [newName, setNewName] = useState('');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingCurrency, setEditingCurrency] = useState('USD');
  const [error, setError] = useState('');

  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(true);

  const [expandedId, setExpandedId] = useState(null);
  const [membersByProfile, setMembersByProfile] = useState({});
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [memberActionError, setMemberActionError] = useState('');

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    const data = await getInvites();
    setInvites(data);
    setInvitesLoading(false);
  }, [getInvites]);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!newName.trim()) { setError('Give the new profile a name, e.g. "Household" or "Side business".'); return; }
    try {
      await createProfile(newName.trim(), newCurrency);
      setNewName('');
      setNewCurrency('USD');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create this profile.');
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditingName(p.name);
    setEditingCurrency(p.currency);
  }

  async function saveEdit(id) {
    if (!editingName.trim()) return;
    await renameProfile(id, editingName.trim());
    await updateProfileCurrency(id, editingCurrency);
    setEditingId(null);
  }

  async function handleDelete(p) {
    if (profiles.length <= 1) {
      setError('You need at least one profile — create another before deleting this one.');
      return;
    }
    const extra = p.member_count > 1 ? ` This also removes access for ${p.member_count - 1} other member${p.member_count - 1 === 1 ? '' : 's'}.` : '';
    if (!confirm(`Delete "${p.name}"? This permanently removes its ${p.transaction_count} transaction${p.transaction_count === 1 ? '' : 's'}.${extra} This cannot be undone.`)) return;
    await deleteProfile(p.id);
  }

  async function toggleMembers(profile) {
    if (expandedId === profile.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(profile.id);
    setInviteEmail('');
    setInviteMessage('');
    setMemberActionError('');
    setMembersLoading(true);
    const members = await getMembers(profile.id);
    setMembersByProfile((prev) => ({ ...prev, [profile.id]: members }));
    setMembersLoading(false);
  }

  async function refreshMembers(profileId) {
    const members = await getMembers(profileId);
    setMembersByProfile((prev) => ({ ...prev, [profileId]: members }));
  }

  async function handleInvite(e, profileId) {
    e.preventDefault();
    setInviteMessage('');
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    try {
      await inviteMember(profileId, inviteEmail.trim());
      setInviteMessage('If an account exists with that email, they’ve been invited — it’ll show up next time they check Profiles.');
      setInviteEmail('');
      await refreshMembers(profileId);
    } catch (err) {
      setInviteMessage(err.response?.data?.error || 'Could not send that invite.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRemoveMember(profileId, memberUserId, isSelf) {
    const msg = isSelf ? 'Leave this household? You’ll lose access to its transactions.' : 'Remove this member? They’ll lose access to this household.';
    if (!confirm(msg)) return;
    setMemberActionError('');
    try {
      await removeMember(profileId, memberUserId);
      if (isSelf) {
        setExpandedId(null);
      } else {
        await refreshMembers(profileId);
      }
    } catch (err) {
      setMemberActionError(err.response?.data?.error || 'Could not complete that action.');
    }
  }

  async function handlePromote(profileId, memberUserId) {
    setMemberActionError('');
    try {
      await promoteMember(profileId, memberUserId);
      await refreshMembers(profileId);
    } catch (err) {
      setMemberActionError(err.response?.data?.error || 'Could not promote this member.');
    }
  }

  async function handleDemote(profileId, memberUserId) {
    if (!confirm('Demote this owner to a regular member?')) return;
    setMemberActionError('');
    try {
      await demoteMember(profileId, memberUserId);
      await refreshMembers(profileId);
    } catch (err) {
      setMemberActionError(err.response?.data?.error || 'Could not demote this owner.');
    }
  }

  async function handleAcceptInvite(profileId) {
    await acceptInvite(profileId);
    await loadInvites();
  }

  async function handleDeclineInvite(profileId) {
    await declineInvite(profileId);
    await loadInvites();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Profiles</h1>
          <div className="subtitle">Keep personal and household budgets separate — invite others into a profile to share it.</div>
        </div>
      </div>

      {!invitesLoading && invites.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--gold)' }}>
          <div className="card-title">Pending invites</div>
          {invites.map((inv) => (
            <div key={inv.profile_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <strong>{inv.profile_name}</strong>
                <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}> — invited by {inv.invited_by_name || 'someone'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={() => handleAcceptInvite(inv.profile_id)}>Accept</button>
                <button className="btn btn-secondary btn-sm" onClick={() => handleDeclineInvite(inv.profile_id)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <form className="card" onSubmit={handleCreate} style={{ marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label>New profile name</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Household, Side business, Vacation fund" />
        </div>
        <div className="form-field">
          <label>Currency</label>
          <select value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Create profile</button>
      </form>

      {profiles.map((p) => {
        const isOwner = p.role === 'owner';
        const isExpanded = expandedId === p.id;
        const members = membersByProfile[p.id] || [];
        const activeOwnerCount = members.filter((m) => m.role === 'owner' && m.status === 'active').length;

        return (
          <div key={p.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                {editingId === p.id ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(p.id); if (e.key === 'Escape') setEditingId(null); }}
                      style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 3 }}
                    />
                    <select value={editingCurrency} onChange={(e) => setEditingCurrency(e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                  </div>
                ) : (
                  <>
                    <strong style={{ fontSize: 15 }}>{p.name}</strong>
                    {p.id === activeProfileId && <span className="tag" style={{ marginLeft: 8 }}>Active</span>}
                    <span className="tag recurring" style={{ marginLeft: 6 }}>{isOwner ? 'Owner' : 'Member'}</span>
                    <span className="tag" style={{ marginLeft: 6 }}>{p.currency}</span>
                  </>
                )}
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                  {formatDate(p.created_at.slice(0, 10))} · {p.transaction_count} transaction{p.transaction_count === 1 ? '' : 's'} · {p.member_count} member{p.member_count === 1 ? '' : 's'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleMembers(p)}>
                      {isExpanded ? 'Hide members' : 'Members'}
                    </button>
                    {isOwner && <button className="btn btn-secondary btn-sm" onClick={() => startEdit(p)}>Edit</button>}
                    {isOwner && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p)}>Delete</button>}
                  </>
                )}
              </div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                {membersLoading ? (
                  <div className="empty-state">Loading members…</div>
                ) : (
                  <>
                    {memberActionError && <div className="auth-error" style={{ marginBottom: 12 }}>{memberActionError}</div>}
                    <table className="ledger" style={{ marginBottom: isOwner ? 14 : 0 }}>
                      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {members.map((m) => {
                          const isSelf = m.email === user?.email;
                          // Any owner can act on anyone; a plain member can
                          // only act on themselves (leave). The backend is
                          // the real source of truth on whether an action
                          // actually succeeds (e.g. the last owner can't
                          // leave/demote) - these just decide what buttons
                          // are worth showing at all.
                          const canManage = isOwner;
                          const canRemove = isSelf || canManage;
                          const isLastActiveOwner = m.role === 'owner' && m.status === 'active' && activeOwnerCount <= 1;
                          return (
                            <tr key={m.user_id}>
                              <td>{m.name}{isSelf && <span style={{ color: 'var(--ink-soft)' }}> (you)</span>}</td>
                              <td className="mono">{m.email}</td>
                              <td className="mono">{m.role}</td>
                              <td>{m.status === 'pending' ? <span className="tag recurring">Invited</span> : <span className="tag">Active</span>}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  {canManage && m.role === 'member' && m.status === 'active' && (
                                    <button className="btn btn-secondary btn-sm" onClick={() => handlePromote(p.id, m.user_id)}>Promote</button>
                                  )}
                                  {canManage && m.role === 'owner' && !isLastActiveOwner && (
                                    <button className="btn btn-secondary btn-sm" onClick={() => handleDemote(p.id, m.user_id)}>Demote</button>
                                  )}
                                  {canRemove && (
                                    <button className="btn btn-danger btn-sm" onClick={() => handleRemoveMember(p.id, m.user_id, isSelf)}>
                                      {isSelf ? 'Leave' : 'Remove'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {isOwner && (
                      <form onSubmit={(e) => handleInvite(e, p.id)} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
                          <label>Invite someone by email</label>
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="their-email@example.com"
                          />
                        </div>
                        <button className="btn btn-primary btn-sm" type="submit" disabled={inviteBusy}>
                          {inviteBusy ? 'Sending…' : 'Send invite'}
                        </button>
                      </form>
                    )}
                    {inviteMessage && <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>{inviteMessage}</p>}
                    {isOwner && (
                      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
                        They need an existing account with that email — there's no email notification sent, so let them know directly to check their Profiles page.
                        A profile can have more than one owner — promote a member any time you want to share management, not just usage.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
