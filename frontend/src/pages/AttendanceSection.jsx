import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import Field from '../components/Field.jsx';

export default function AttendanceSection() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState({ date: '', classNo: '1', topic: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api(`/attendance/sections/${sectionId}/sessions`);
    if (!r.ok) { setNotice({ ok: false, text: errorMessage(r) }); return; }
    setData(r.body.data);
    setForm((f) => ({ ...f, date: f.date || r.body.data.today }));
    const s = await api(`/attendance/sections/${sectionId}/summary`);
    if (s.ok) setSummary(s.body.data);
  }, [sectionId]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api(`/attendance/sections/${sectionId}/sessions`, { method: 'POST', body: form });
    setBusy(false);
    if (r.ok) navigate(`/attendance/sessions/${r.body.data.session.id}`);
    else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };

  if (!data) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const s = data.section;
  return (
    <section className="panel">
      <p><Link to="/teaching">My classes</Link></p>
      <h1>Attendance: {s.courseCode} section {s.sectionCode}</h1>
      <p>{s.courseTitle} · {s.semesterName}</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}

      {data.canMark && (
        <form className="editor" onSubmit={create} noValidate>
          <h3>Record a class</h3>
          <Field id="date" label="Date" type="date" value={form.date} max={data.today} onChange={(e) => setForm({ ...form, date: e.target.value })} error={errors.date} />
          <Field id="classNo" label="Class number that day" type="number" min="1" max="5" value={form.classNo} onChange={(e) => setForm({ ...form, classNo: e.target.value })} error={errors.classNo} hint="Use 2 for a second class on the same day." />
          <Field id="topic" label="Topic (optional)" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} error={errors.topic} />
          <button className="btn btn-solid" disabled={busy}>{busy ? 'Creating...' : 'Create and mark attendance'}</button>
        </form>
      )}

      <h2>Classes held</h2>
      {data.sessions.length === 0 ? <p className="empty">No classes recorded yet.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Date</th><th>No.</th><th>Topic</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th></tr></thead>
          <tbody>{data.sessions.map((x) => (
            <tr key={x.id}><td><Link to={`/attendance/sessions/${x.id}`}>{x.date}</Link></td><td>{x.classNo}</td><td>{x.topic || '-'}</td><td>{x.present}</td><td>{x.late}</td><td>{x.absent}</td><td>{x.excused}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      {summary && (
        <>
          <h2>Students ({summary.sessionsHeld} classes held)</h2>
          <p className="hint">Late counts as attended. Excused classes are not counted. Minimum required: {summary.minPercent}%.</p>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Attendance</th></tr></thead>
            <tbody>{summary.students.map((x) => (
              <tr key={x.studentId}><td>{x.studentCode} {x.fullName}</td><td>{x.present}</td><td>{x.late}</td><td>{x.absent}</td><td>{x.excused}</td>
                <td>{x.percentage === null ? '-' : `${x.percentage}%`} {x.below && <span className="badge badge-blocked">Below minimum</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </section>
  );
}
