import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';

export default function UserForm() {
  const { isSuperAdmin, isPlatform } = useAuth();
  const [universities, setUniversities] = useState([]);
  const navigate = useNavigate();
  const [f, setF] = useState({ loginId: '', fullName: '', email: '', phone: '', role: 'teacher', temporaryPassword: '', universityId: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isPlatform) api('/universities?pageSize=200').then((r) => r.ok && setUniversities(r.body.data.items.filter((u) => u.status === 'active')));
  }, [isPlatform]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMessage(''); setErrors({});
    const r = await api('/users', { method: 'POST', body: f });
    setBusy(false);
    if (r.ok) navigate(`/users/${r.body.data.user.id}`, { state: { created: true } });
    else { setErrors(fieldErrors(r)); setMessage(errorMessage(r)); }
  };

  return (
    <section className="panel narrow-panel">
      <p><Link to="/users">Back to users</Link></p>
      <h1>Add user</h1>
      <p className="hint">Teacher and staff accounts. Student accounts are created through student registration.</p>
      {message && <div className="alert alert-error" role="alert">{message}</div>}
      <form onSubmit={submit} noValidate>
        <Field id="fullName" label="Full name" value={f.fullName} onChange={set('fullName')} error={errors.fullName} required />
        <Field id="loginId" label="Login ID" value={f.loginId} onChange={set('loginId')} error={errors.loginId} autoComplete="off" required />
        <Field id="email" label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} required />
        <Field id="phone" label="Phone (optional)" value={f.phone} onChange={set('phone')} error={errors.phone} hint="Example: +8801712345678" />
        <div className="field">
          <label htmlFor="role">Role</label>
          <select id="role" value={f.role} onChange={set('role')}>
            <option value="teacher">Teacher</option>
            <option value="staff">Staff</option>
            {isSuperAdmin && <option value="super_admin">Super Admin</option>}
          </select>
          {errors.role && <p className="field-error">{errors.role}</p>}
        </div>
        {isPlatform && f.role !== 'super_admin' && (
          <div className="field">
            <label htmlFor="universityId">University</label>
            <select id="universityId" value={f.universityId} onChange={set('universityId')} aria-invalid={!!errors.universityId}>
              <option value="">Choose a university</option>
              {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {errors.universityId && <p className="field-error">{errors.universityId}</p>}
          </div>
        )}
        <Field id="temporaryPassword" label="Temporary password" type="text" value={f.temporaryPassword} onChange={set('temporaryPassword')} error={errors.temporaryPassword} hint="The user must change it at first sign-in. Share it securely; email delivery is added in a later phase." autoComplete="off" required />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create user'}</button>
      </form>
    </section>
  );
}
