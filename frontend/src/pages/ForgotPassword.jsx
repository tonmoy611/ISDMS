import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import Field from '../components/Field.jsx';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('request');
  const [f, setF] = useState({ loginId: '', channel: 'email', code: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const request = async (e) => {
    e.preventDefault(); setBusy(true); setMessage(''); setErrors({});
    const r = await api('/auth/password/forgot', { method: 'POST', body: { loginId: f.loginId, channel: f.channel } });
    setBusy(false);
    if (r.ok) setStep('reset'); else { setErrors(fieldErrors(r)); setMessage(errorMessage(r)); }
  };

  const reset = async (e) => {
    e.preventDefault(); setMessage(''); setErrors({});
    if (f.newPassword !== f.confirm) { setErrors({ confirm: 'The two passwords do not match.' }); return; }
    setBusy(true);
    const r = await api('/auth/password/reset', { method: 'POST', body: { loginId: f.loginId, code: f.code.trim(), newPassword: f.newPassword } });
    setBusy(false);
    if (r.ok) navigate('/login', { replace: true, state: { reset: true } });
    else { setErrors(fieldErrors(r)); setMessage(errorMessage(r)); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">I</span>ISDMS</Link>
        <h1>Reset password</h1>
        {message && <div className="alert alert-error" role="alert">{message}</div>}
        {step === 'request' ? (
          <form onSubmit={request} noValidate>
            <p className="hint">Enter your login ID or email. If an account matches, we send a reset code.</p>
            <Field id="loginId" label="Login ID or email" value={f.loginId} onChange={set('loginId')} error={errors.loginId} autoComplete="username" autoFocus required />
            <div className="field">
              <label htmlFor="channel">Send the code by</label>
              <select id="channel" value={f.channel} onChange={set('channel')}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending...' : 'Send reset code'}</button>
          </form>
        ) : (
          <form onSubmit={reset} noValidate>
            <div className="alert alert-info" role="status">If an account matches, a code is on its way. It expires soon.</div>
            <Field id="code" label="Reset code" value={f.code} onChange={set('code')} error={errors.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required />
            <Field id="newPassword" label="New password" type="password" value={f.newPassword} onChange={set('newPassword')} error={errors.newPassword} hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number." autoComplete="new-password" required />
            <Field id="confirm" label="Confirm new password" type="password" value={f.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" required />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button>
          </form>
        )}
        <p className="hint"><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
