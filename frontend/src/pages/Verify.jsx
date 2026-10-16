import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';

// First sign-in for a new account: confirm identity by a one-time code, then choose a new password.
export default function Verify() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [step, setStep] = useState('choose');
  const [channel, setChannel] = useState(state?.channels?.[0]?.channel || '');
  const [sentTo, setSentTo] = useState('');
  const [f, setF] = useState({ code: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!state?.token) return <Navigate to="/login" replace />;
  if (!state.channels.length) {
    return (
      <div className="auth-page"><div className="auth-card">
        <h1>Verification unavailable</h1>
        <p>No email address or phone number is available for this account. Please contact your university office.</p>
        <Link to="/login">Back to sign in</Link>
      </div></div>
    );
  }

  const send = async () => {
    setBusy(true); setMessage('');
    const r = await api('/auth/verification/send', { method: 'POST', body: { verificationToken: state.token, channel } });
    setBusy(false);
    if (r.ok) { setSentTo(r.body.data.destination); setStep('code'); setCooldown(60); }
    else setMessage(errorMessage(r));
  };

  const complete = async (e) => {
    e.preventDefault(); setMessage(''); setErrors({});
    if (f.newPassword !== f.confirm) { setErrors({ confirm: 'The two passwords do not match.' }); return; }
    setBusy(true);
    const r = await api('/auth/verification/complete', { method: 'POST', body: { verificationToken: state.token, code: f.code.trim(), newPassword: f.newPassword } });
    setBusy(false);
    if (r.ok) { setSession(r.body.data.user); navigate('/dashboard', { replace: true }); }
    else { setErrors(fieldErrors(r)); setMessage(errorMessage(r)); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">I</span>ISDMS</Link>
        <h1>Verify your account</h1>
        {message && <div className="alert alert-error" role="alert">{message}</div>}
        {step === 'choose' ? (
          <>
            <p className="hint">For your security, we send a one-time code to confirm it is you. Where should we send it?</p>
            <fieldset className="choice">
              <legend className="sr-only">Send the code to</legend>
              {state.channels.map((c) => (
                <label key={c.channel}><input type="radio" name="channel" checked={channel === c.channel} onChange={() => setChannel(c.channel)} /> {c.channel === 'email' ? 'Email' : 'SMS'}: {c.masked}</label>
              ))}
            </fieldset>
            <button className="btn btn-primary" onClick={send} disabled={busy || !channel}>{busy ? 'Sending...' : 'Send code'}</button>
          </>
        ) : (
          <form onSubmit={complete} noValidate>
            <p className="hint">We sent a 6-digit code to {sentTo}. It works once and expires soon.</p>
            <Field id="code" label="Verification code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={errors.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required />
            <Field id="newPassword" label="New password" type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} error={errors.newPassword} hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number." autoComplete="new-password" required />
            <Field id="confirm" label="Confirm new password" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} error={errors.confirm} autoComplete="new-password" required />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Verifying...' : 'Verify and continue'}</button>
            <p className="hint"><button type="button" className="link-btn" onClick={send} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</button></p>
          </form>
        )}
      </div>
    </div>
  );
}
