import { useEffect, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import ProfileFields from '../components/ProfileFields.jsx';

const SELF = ['guardianPhone', 'presentAddress', 'permanentAddress', 'emergencyContactName', 'emergencyContactPhone'];

export default function MyProfile() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = (st) => { setS(st); setForm(Object.fromEntries(SELF.map((k) => [k, st[k] ?? '']))); };
  useEffect(() => { api('/students/me').then((r) => (r.ok ? apply(r.body.data.student) : setNotice({ ok: false, text: errorMessage(r) }))); }, []);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api('/students/me', { method: 'PATCH', body: form });
    setBusy(false); setErrors(fieldErrors(r));
    if (r.ok) { apply(r.body.data.student); setNotice({ ok: true, text: 'Your details were saved.' }); } else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!s) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  return (
    <section className="panel">
      <h1>My profile</h1>
      <table className="map-table">
        <caption>Academic information</caption>
        <tbody>
          {[['Name', s.fullName], ['Student ID', s.studentId], ['Email', s.email], ['Phone', s.phone], ['Department', s.departmentName], ['Program', s.programName],
            ['Batch', s.batchName], ['Academic year', s.academicYearName], ['Semester', s.semesterName], ['Shift', s.shiftName], ['Admission date', s.admissionDate], ['Academic status', s.academicStatus]]
            .map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v || '-'}</td></tr>)}
        </tbody>
      </table>
      <p className="hint">To change your name, email, phone or academic details, contact the university office.</p>
      <h2>Contact details you can edit</h2>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      <form className="narrow-panel" onSubmit={save} noValidate>
        <ProfileFields only={SELF} values={form} onChange={(p) => setForm({ ...form, ...p })} errors={errors} />
        <button className="btn btn-solid" disabled={busy}>Save</button>
      </form>
    </section>
  );
}
