import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authService } from '../services/auth.service';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// A JWT's payload is plain base64url JSON — decode locally to check expiry so
// an expired 7-day session goes straight back to login instead of rendering a
// broken app until the first 401. (No signature check here — the server does
// that; this is purely a UX fast-path.)
function tokenIsLive(token) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/**
 * Single source of truth for auth state. Hydrates from localStorage so a
 * 7-day session survives reloads, then re-syncs against /auth/me so a role
 * change or deleted account takes effect on next load rather than lingering
 * until a 401. The axios interceptor (services/api.js) reads the same
 * localStorage keys, so token writes here keep it in sync.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  const persist = useCallback((nextUser, token) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Session integrity on load: drop expired tokens immediately; otherwise
  // refresh the user record (role may have changed / account deleted).
  useEffect(() => {
    if (!AUTH_ENABLED) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    if (!tokenIsLive(token)) {
      logout();
      return;
    }
    let cancelled = false;
    authService.getMe()
      .then((fresh) => {
        if (cancelled || !fresh) return;
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        setUser(fresh);
      })
      .catch((err) => {
        // 401/403 = session no longer valid server-side; network errors are
        // left alone so a flaky connection doesn't log anyone out.
        if (!cancelled && [401, 403].includes(err.response?.status)) logout();
      });
    return () => { cancelled = true; };
  }, [logout]);

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

  const token = localStorage.getItem(TOKEN_KEY);
  const value = {
    user,
    isAuthenticated: tokenIsLive(token),
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
