import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import client, { SESSION_EXPIRED_EVENT } from '../api/client';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem('finance_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupted value: treat as logged out rather than crash on load
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  // The API client fires this on any 401 (expired or invalid token).
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const persist = (token, user) => {
    localStorage.setItem('finance_token', token);
    localStorage.setItem('finance_user', JSON.stringify(user));
    setUser(user);
  };

  const login = useCallback(async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password });
    persist(data.token, data.user);
  }, []);

  const register = useCallback(async (name, email, password) => {
    const { data } = await client.post('/auth/register', { name, email, password });
    persist(data.token, data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('finance_token');
    localStorage.removeItem('finance_user');
    localStorage.removeItem('finance_active_profile');
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async (password) => {
    await client.delete('/auth/account', { data: { password } });
    logout();
  }, [logout]);

  // The server signs out every other session and hands back a fresh token
  // for this one (the old one stops working the moment the change lands).
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { data } = await client.post('/auth/password', { currentPassword, newPassword });
    localStorage.setItem('finance_token', data.token);
  }, []);

  const logoutEverywhere = useCallback(async () => {
    await client.post('/auth/logout-all');
    logout();
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, login, register, logout, deleteAccount, changePassword, logoutEverywhere, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
