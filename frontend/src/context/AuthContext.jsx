import { createContext, useContext, useState, useCallback } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('finance_user');
    return raw ? JSON.parse(raw) : null;
  });

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

  return (
    <AuthContext.Provider value={{ user, login, register, logout, deleteAccount, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
