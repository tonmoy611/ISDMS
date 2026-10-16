import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Registration from '../components/Registration.jsx';

function PriorCredits({ studentId }) {
  const { can } = useAuth();
  const canManage = can('enrollment.manage');
  const [credits, setCredits] = useState([]);
  const [courses, setCourses] = useState([]);
  const [f, setF] = useState({ courseId: '', source: 'transfer', note: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const r = await api(`/enrollment/students/${studentId}/prior-credits`);
    if (r.ok) setCredits(r.body.data.credits);
    const o = await api(`/enrollment/students/${studentId}/overview`);
    if (o.ok && canManage) {
      const c = await api(`/structure/courses?pageSize=200&universityId=${o.body.data.student.universityId}`);
      if (c.ok) setCourses(c.body.data.items);
    }
  }, [studentId, canManage]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault(); setErrors({}); setNotice(null);
    const r = await api(`/enrollment/students/${studentId}/prior-credits`, { method: 'POST', body: f });
    if (r.ok) { setCredits(r.body.data.credits); setF({ ...f, courseId: '', note: '' }); setNotice({ ok: true, text: 'Recorded.' }); } else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const remove = async (id) => {
    const r = await api(`/enrollment/students/${studentId}/prior-credits/${id}`, { method: 'DELETE' });
    if (r.ok) setCredits(r.body.data.credits); else setNotice({ ok: false, text: errorMessage(r) });
  };

  return (
    <div>
      <h2>Courses already completed (transfer, exemption, older records)</h2>
      <p className="hint">These count as passed when prerequisites are checked.</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {credits.length === 0 ? <p className="hint">None recorded.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Course</th><th>Source</th><th>Note</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{credits.map((c) => <tr key={c.id}><td>{c.code}: {c.title}</td><td>{c.source}</td><td>{c.note || '-'}</td>{canManage && <td><button className="link-btn danger" onClick={() => remove(c.id)}>Remove</button></td>}</tr>)}</tbody>
        </table></div>
      )}
      {canManage && (
        <form className="editor" onSubmit={add} noValidate>
          <div className="field">
            <label htmlFor="pc-course">Course</label>
            <select id="pc-course" value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })} aria-invalid={!!errors.courseId}>
              <option value="">Choose a course</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}
            </select>
            {errors.courseId && <p className="field-error">{errors.courseId}</p>}
          </div>
          <div className="field">
            <label htmlFor="pc-source">Source</label>
            <select id="pc-source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              <option value="transfer">Transfer</option><option value="exemption">Exemption</option><option value="legacy">Older record</option>
            </select>
          </div>
          <div className="field"><label htmlFor="pc-note">Note (optional)</label><input id="pc-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn btn-solid">Record</button>
        </form>
      )}
    </div>
  );
}

export default function StudentEnrollment() {
  const { id } = useParams();
  return (
    <section className="panel">
      <p><Link to={`/students/${id}`}>Back to student</Link></p>
      <h1>Enrollment</h1>
      <Registration studentId={id} />
      <PriorCredits studentId={id} />
    </section>
  );
}
