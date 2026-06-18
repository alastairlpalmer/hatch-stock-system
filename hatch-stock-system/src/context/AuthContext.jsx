import React, { createContext, useContext, useState, useCallback } from 'react';
import { authService } from '../services/auth.service';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Single source of truth for auth state. Hydrates from localStorage so a
 * 7-day session survives reloads. The axios interceptor (services/api.js)
 * reads the same localStorage keys, so token writes here keep it in sync.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  const persist = useCallback((nextUser, token) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = useCallback(async (email, password) => {
    const { user: nextUser, token } = await authService.login(email, password);
    persist(nextUser, token);
    return nextUser;
  }, [persist]);

  const register = useCallback(async (payload) => {
    const { user: nextUser, token } = await authService.register(payload);
    persist(nextUser, token);
    return nextUser;
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const value = {
    user,
    isAuthenticated: !!localStorage.getItem(TOKEN_KEY),
    isAdmin: user?.role === 'admin',
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
