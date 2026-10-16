import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** Blocks signed-out users, forces a password change when required, and optionally limits by role. */
export default function ProtectedRoute({ roles, permission }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <p className="page-loading" role="status">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (roles && user.role !== 'super_admin' && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  if (permission && !can(permission)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
