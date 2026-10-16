import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, fieldErrors } from '../services/api.js';
import Field from '../components/Field.jsx';

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({});

  if (!loading && user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/dashboard'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMessage(''); setErrors({});
    const res = await login(loginId, password);
    setBusy(false);
    if (res.ok && res.body.data.verificationRequired) {
      navigate('/verify', { replace: true, state: { token: res.body.data.verificationToken, channels: res.body.data.channels, loginId } });
    } else if (res.ok) {
      const u = res.body.data.user;
      navigate(u.mustChangePassword ? '/change-password' : (location.state?.from || '/dashboard'), { replace: true });
    } else {
      setErrors(fieldErrors(res));
      setMessage(errorMessage(res));
      setPassword('');
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">I</span>ISDMS</Link>
        <h1>Sign in</h1>
        <p className="hint">Student accounts are created by your university. Use the login ID or email you were given.</p>
        {location.state?.reset && !message && <div className="alert alert-ok" role="status">Password changed. Sign in with your new password.</div>}
        {message && <div className="alert alert-error" role="alert">{message}</div>}
        <Field id="loginId" label="Login ID or email" value={loginId} onChange={(e) => setLoginId(e.target.value)} error={errors.loginId} autoComplete="username" autoFocus required />
        <Field id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="current-password" required />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <p className="hint"><Link to="/forgot-password">Forgot your password?</Link></p>
      </form>
    </div>
  );
}
