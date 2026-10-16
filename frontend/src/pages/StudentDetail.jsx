import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';
import Placement from '../components/Placement.jsx';
import ProfileFields, { PROFILE_FIELDS } from '../components/ProfileFields.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { statusLabel } from './Users.jsx';

const actions = {
  active: [['blocked', 'Block', true], ['inactive', 'Deactivate', true]],
  blocked: [['active', 'Unblock', false]],
  inactive: [['active', 'Activate', false]],
  pending_verification: [['blocked', 'Block', true]],
};
const EDIT = ['fullName', 'email', 'phone', 'academicStatus', 'departmentId', 'programId', 'batchId', 'academicYearId', 'semesterId', 'shiftId', ...PROFILE_FIELDS.map((p) => p[0])];

export default function StudentDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [s, setS] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(state?.created ? { ok: true, text: 'Student registered.' } : null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tempPw, setTempPw] = useState('');

  const apply = (student) => { setS(student); setForm(Object.fromEntries(EDIT.map((k) => [k, student[k] ?? '']))); };
  const load = useCallback(async () => {
    const r = await api(`/students/${id}`);
    if (r.ok) apply(r.body.data.student); else setNotice({ ok: false, text: errorMessage(r) });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const say = (r, okText) => setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: errorMessage(r) });
  const merge = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({});
    const r = await api(`/students/${id}`, { method: 'PATCH', body: form });
    setBusy(false); setErrors(fieldErrors(r)); say(r, 'Student saved.');
    if (r.ok) apply(r.body.data.student);
  };
  const run = async () => {
    setBusy(true);
    const r = confirm.kind === 'delete' ? await api(`/students/${id}`, { method: 'DELETE' })
      : await api(`/students/${id}/status`, { method: 'POST', body: { status: confirm.status } });
    setBusy(false); setConfirm(null);
    if (r.ok && confirm.kind === 'delete') { navigate('/students', { replace: true }); return; }
    say(r, 'Account updated.');
    if (r.ok) apply(r.body.data.student);
  };
  const reset = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api(`/students/${id}/reset-password`, { method: 'POST', body: { temporaryPassword: tempPw } });
    setBusy(false); setErrors(fieldErrors(r)); say(r, 'Temporary password set. The student must change it at next sign-in.');
    if (r.ok) setTempPw('');
  };

  if (!s) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;

  return (
    <section className="panel">
      <p><Link to="/students">Back to students</Link></p>
      <h1>{s.fullName}</h1>
      <p><span className={`badge badge-${s.accountStatus}`}>{statusLabel[s.accountStatus]}</span> Student ID {s.studentId} · {s.academicStatus}</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}

      {can('enrollment.view') && <p><Link to={`/students/${id}/enrollment`}>View course registration</Link></p>}
      {can('attendance.view') && <p><Link to={`/students/${id}/attendance`}>View attendance</Link></p>}
      {can('results.view') && <p><Link to={`/students/${id}/results`}>View results</Link></p>}
      {can('finance.view') && <p><Link to={`/students/${id}/finance`}>Fees and payments</Link></p>}
      {can('documents.issue') && <p><Link to={`/students/${id}/documents`}>Documents</Link></p>}
      <table className="map-table">
        <caption>Academic placement</caption>
        <tbody>
          <tr><th scope="row">Department</th><td>{s.departmentName}</td></tr>
          <tr><th scope="row">Program</th><td>{s.programName}</td></tr>
          <tr><th scope="row">Batch</th><td>{s.batchName}</td></tr>
          <tr><th scope="row">Academic year</th><td>{s.academicYearName}</td></tr>
          <tr><th scope="row">Semester</th><td>{s.semesterName}</td></tr>
          <tr><th scope="row">Shift</th><td>{s.shiftName}</td></tr>
        </tbody>
      </table>

      {can('students.status') && (
        <div className="btn-row">
          {(actions[s.accountStatus] || []).map(([status, label, danger]) => (
            <button key={status} className={danger ? 'btn btn-danger' : 'btn btn-solid'} onClick={() => setConfirm({ kind: 'status', status, label, danger })}>{label}</button>
          ))}
        </div>
      )}

      {can('students.update') && (
        <>
          <h2>Edit record</h2>
          <form className="narrow-panel" onSubmit={save} noValidate>
            <Field id="fullName" label="Student name" value={form.fullName} onChange={(e) => merge({ fullName: e.target.value })} error={errors.fullName} />
            <Field id="email" label="Email" value={form.email} onChange={(e) => merge({ email: e.target.value })} error={errors.email} />
            <Field id="phone" label="Phone" value={form.phone} onChange={(e) => merge({ phone: e.target.value })} error={errors.phone} />
            <div className="field">
              <label htmlFor="academicStatus">Academic status</label>
              <select id="academicStatus" value={form.academicStatus} onChange={(e) => merge({ academicStatus: e.target.value })}>
                {['studying', 'graduated', 'withdrawn', 'suspended'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <Placement values={form} onChange={merge} errors={errors} universityId={s.universityId} />
            <ProfileFields values={form} onChange={merge} errors={errors} />
            <button className="btn btn-solid" disabled={busy}>Save</button>
          </form>

          <h2>Reset password</h2>
          <form className="narrow-panel" onSubmit={reset} noValidate>
            <Field id="tempPw" label="Temporary password" value={tempPw} onChange={(e) => setTempPw(e.target.value)} error={errors.temporaryPassword} hint="Signs the student out everywhere and requires a new password at next sign-in." autoComplete="off" />
            <button className="btn btn-solid" disabled={busy || !tempPw}>Set temporary password</button>
          </form>
        </>
      )}

      {can('students.delete') && (
        <>
          <h2>Remove student</h2>
          <p className="hint">The record is kept for audit, but the account stops working and the student ID, email and phone stay reserved.</p>
          <button className="btn btn-danger" onClick={() => setConfirm({ kind: 'delete', label: 'Remove', danger: true })}>Remove student</button>
        </>
      )}

      <ConfirmDialog open={!!confirm} busy={busy} danger={confirm?.danger} confirmLabel={confirm?.label}
        title={confirm?.kind === 'delete' ? 'Remove this student?' : `${confirm?.label} this account?`}
        message={confirm?.kind === 'delete' ? 'The student is signed out and can no longer use the system.' : confirm?.status === 'active' ? 'The student will be able to sign in again.' : 'The student is signed out immediately.'}
        onConfirm={run} onCancel={() => setConfirm(null)} />
    </section>
  );
}
