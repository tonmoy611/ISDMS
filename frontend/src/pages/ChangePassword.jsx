import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, fieldErrors } from '../services/api.js';
import Field from '../components/Field.jsx';

export default function ChangePassword() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setMessage(''); setErrors({});
    if (form.next !== form.confirm) { setErrors({ confirm: 'The two new passwords do not match.' }); return; }
    setBusy(true);
    const res = await changePassword(form.current, form.next);
    setBusy(false);
    if (res.ok) navigate('/dashboard', { replace: true, state: { passwordChanged: true } });
    else { setErrors(fieldErrors(res)); setMessage(errorMessage(res)); }
  };

  return (
    <section className="panel narrow-panel">
      <h1>Change password</h1>
      {user.mustChangePassword && <div className="alert alert-info">You must set a new password before you can use ISDMS.</div>}
      {message && <div className="alert alert-error" role="alert">{message}</div>}
      <form onSubmit={submit} noValidate>
        <Field id="current" label="Current password" type="password" value={form.current} onChange={set('current')} error={errors.currentPassword} autoComplete="current-password" required />
        <Field id="next" label="New password" type="password" value={form.next} onChange={set('next')} error={errors.newPassword} hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number." autoComplete="new-password" required />
        <Field id="confirm" label="Confirm new password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" required />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save new password'}</button>
      </form>
      <p className="hint">Saving signs you out of all other devices.</p>
    </section>
  );
}
