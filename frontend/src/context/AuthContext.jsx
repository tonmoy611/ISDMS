import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api('/auth/me')
      .then((r) => alive && setUser(r.ok ? r.body.data.user : null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (loginId, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { loginId, password } });
    if (r.ok && r.body.data.user) setUser(r.body.data.user);
    return r;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const r = await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    if (r.ok) setUser(r.body.data.user);
    return r;
  }, []);

  const can = useCallback((code) => !!user && (user.permissions?.includes('*') || user.permissions?.includes(code)), [user]);
  const isSuperAdmin = user?.role === 'super_admin';
  const isPlatform = isSuperAdmin && user?.universityId == null;

  const value = useMemo(() => ({ user, setSession: setUser, loading, login, logout, changePassword, can, isSuperAdmin, isPlatform }), [user, loading, login, logout, changePassword, can, isSuperAdmin, isPlatform]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
