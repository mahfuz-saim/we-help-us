/**
 * AuthProvider
 *
 * Holds the current user object and JWT in a single React context so
 * any descendant can call useAuth() without prop-drilling.
 *
 * The actual /api/auth/* wiring lands in Module 1.3. For the skeleton
 * we expose the same shape and persist the token so the auth round-trip
 * is already plumbed — pages render gracefully when there's no user
 * (loading=false, user=null).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import api from '../services/api';
import { TOKEN_STORAGE_KEY } from '../utils/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [loading, setLoading] = useState(Boolean(token)); // only loading if a token exists

  // Hydrate user from token on mount (or when token changes).
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get('/auth/me');
        if (!cancelled) setUser(data?.data || null);
      } catch {
        // Token invalid → clear it. Module 1.3 wires login redirect.
        if (!cancelled) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    const newToken = data?.data?.token;
    const newUser = data?.data?.user || null;
    if (newToken) localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken || null);
    setUser(newUser);
    return newUser;
  }, []);

  const register = useCallback(async (payload) => {
    // Server enforces OWNER/VOLUNTEER only (Module 1.2/1.3). Client-side we
    // also strip any non-public role from the payload — defense in depth.
    const safePayload = { ...payload };
    if (
      safePayload.role &&
      !['OWNER', 'VOLUNTEER'].includes(safePayload.role)
    ) {
      delete safePayload.role;
    }
    const { data } = await api.post('/auth/register', safePayload);
    const newToken = data?.data?.token;
    const newUser = data?.data?.user || null;
    if (newToken) localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken || null);
    setUser(newUser);
    return newUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore — even if the server says the token is bad, we want to
         clear local state. */
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  /**
   * Refresh the user object without forcing a re-login. Used after the
   * user updates their profile (Module 1.4).
   */
  const refreshUser = useCallback(async () => {
    if (!token) return null;
    const { data } = await api.get('/auth/me');
    const fresh = data?.data || null;
    setUser(fresh);
    return fresh;
  }, [token]);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, refreshUser }),
    [user, token, loading, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used inside <AuthProvider>.');
  }
  return ctx;
}