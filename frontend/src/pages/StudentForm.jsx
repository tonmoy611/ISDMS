import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';
import Placement from '../components/Placement.jsx';
import ProfileFields from '../components/ProfileFields.jsx';

const empty = { studentId: '', fullName: '', email: '', phone: '', temporaryPassword: '', universityId: '', departmentId: '', programId: '', batchId: '', academicYearId: '', semesterId: '', shiftId: '' };

export default function StudentForm() {
  const { isPlatform } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState(empty);
  const [unis, setUnis] = useState([]);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const merge = (patch) => setF((s) => ({ ...s, ...patch }));
  const set = (k) => (e) => merge({ [k]: e.target.value });

  useEffect(() => { if (isPlatform) api('/universities?pageSize=200').then((r) => r.ok && setUnis(r.body.data.items.filter((u) => u.status === 'active'))); }, [isPlatform]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMessage(''); setErrors({});
    const r = await api('/students', { method: 'POST', body: f });
    setBusy(false);
    if (r.ok) navigate(`/students/${r.body.data.student.id}`, { state: { created: true } });
    else { setErrors(fieldErrors(r)); setMessage(errorMessage(r)); }
  };

  return (
    <section className="panel narrow-panel">
      <p><Link to="/students">Back to students</Link></p>
      <h1>Register student</h1>
      <p className="hint">The account starts as awaiting verification. The student verifies by email or phone, then sets their own password.</p>
      {message && <div className="alert alert-error" role="alert">{message}</div>}
      <form onSubmit={submit} noValidate>
        {isPlatform && (
          <div className="field">
            <label htmlFor="universityId">University</label>
            <select id="universityId" value={f.universityId} onChange={(e) => merge({ universityId: e.target.value, departmentId: '', programId: '', batchId: '', academicYearId: '', semesterId: '', shiftId: '' })} aria-invalid={!!errors.universityId}>
              <option value="">Choose a university</option>
              {unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {errors.universityId && <p className="field-error">{errors.universityId}</p>}
          </div>
        )}
        <h2>Account</h2>
        <Field id="studentId" label="Student ID" value={f.studentId} onChange={set('studentId')} error={errors.studentId} autoComplete="off" required />
        <Field id="fullName" label="Student name" value={f.fullName} onChange={set('fullName')} error={errors.fullName} required />
        <Field id="email" label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} required />
        <Field id="phone" label="Phone" value={f.phone} onChange={set('phone')} error={errors.phone} hint="Example: +8801712345678" required />
        <Field id="temporaryPassword" label="Temporary password" value={f.temporaryPassword} onChange={set('temporaryPassword')} error={errors.temporaryPassword} hint="Replaced by the student at first sign-in. Email delivery is added in a later phase." autoComplete="off" required />
        <h2>Academic placement</h2>
        {isPlatform && !f.universityId ? <p className="hint">Choose a university first.</p>
          : <Placement values={f} onChange={merge} errors={errors} universityId={isPlatform ? f.universityId : undefined} />}
        <h2>Admission and personal details</h2>
        <ProfileFields values={f} onChange={merge} errors={errors} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Registering...' : 'Register student'}</button>
      </form>
    </section>
  );
}
