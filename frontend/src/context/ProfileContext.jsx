import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import client from '../api/client';
import { useAuth } from './AuthContext.jsx';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(() => {
    const stored = localStorage.getItem('finance_active_profile');
    return stored ? Number(stored) : null;
  });
  const [loading, setLoading] = useState(true);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    const [{ data }, invitesRes] = await Promise.all([
      client.get('/profiles'),
      client.get('/profiles/invites'),
    ]);
    setProfiles(data.profiles);
    setPendingInviteCount(invitesRes.data.invites.length);
    // If there's no active profile yet, or the stored one no longer
    // exists (e.g. it was deleted in another tab), fall back to the first.
    setActiveProfileId((current) => {
      const stillValid = data.profiles.some((p) => p.id === current);
      const next = stillValid ? current : data.profiles[0]?.id ?? null;
      if (next) localStorage.setItem('finance_active_profile', String(next));
      return next;
    });
    setLoading(false);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) refresh();
    else { setProfiles([]); setActiveProfileId(null); }
  }, [isAuthenticated, refresh]);

  const switchProfile = useCallback((id) => {
    setActiveProfileId(id);
    localStorage.setItem('finance_active_profile', String(id));
  }, []);

  const createProfile = useCallback(async (name) => {
    const { data } = await client.post('/profiles', { name });
    await refresh();
    switchProfile(data.id);
  }, [refresh, switchProfile]);

  const renameProfile = useCallback(async (id, name) => {
    await client.put(`/profiles/${id}`, { name });
    await refresh();
  }, [refresh]);

  const deleteProfile = useCallback(async (id) => {
    await client.delete(`/profiles/${id}`);
    await refresh();
  }, [refresh]);

  // ---------- Sharing / household membership ----------

  const inviteMember = useCallback(async (profileId, email) => {
    await client.post(`/profiles/${profileId}/members`, { email });
  }, []);

  const getMembers = useCallback(async (profileId) => {
    const { data } = await client.get(`/profiles/${profileId}/members`);
    return data.members;
  }, []);

  const removeMember = useCallback(async (profileId, userId) => {
    await client.delete(`/profiles/${profileId}/members/${userId}`);
    // Removing yourself (leaving) changes which profiles you can see.
    await refresh();
  }, [refresh]);

  const getInvites = useCallback(async () => {
    const { data } = await client.get('/profiles/invites');
    return data.invites;
  }, []);

  const acceptInvite = useCallback(async (profileId) => {
    await client.post(`/profiles/invites/${profileId}/accept`);
    await refresh();
  }, [refresh]);

  const declineInvite = useCallback(async (profileId) => {
    await client.post(`/profiles/invites/${profileId}/decline`);
    await refresh();
  }, [refresh]);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  return (
    <ProfileContext.Provider
      value={{
        profiles, activeProfileId, activeProfile, loading, pendingInviteCount,
        switchProfile, createProfile, renameProfile, deleteProfile,
        inviteMember, getMembers, removeMember, getInvites, acceptInvite, declineInvite,
        refresh,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfiles() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfiles must be used within ProfileProvider');
  return ctx;
}
