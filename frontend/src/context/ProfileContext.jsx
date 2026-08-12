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

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    const { data } = await client.get('/profiles');
    setProfiles(data.profiles);
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

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  return (
    <ProfileContext.Provider
      value={{ profiles, activeProfileId, activeProfile, loading, switchProfile, createProfile, renameProfile, deleteProfile, refresh }}
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
