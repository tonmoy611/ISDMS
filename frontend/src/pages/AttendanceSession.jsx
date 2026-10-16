import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const OPTIONS = [['present', 'Present'], ['late', 'Late'], ['absent', 'Absent'], ['excused', 'Excused']];

export default function AttendanceSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [marks, setMarks] = useState({});
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const apply = (d) => { setData(d); setMarks(Object.fromEntries(d.students.map((s) => [s.studentId, { status: s.status || '', note: s.note || '' }]))); };
  useEffect(() => { api(`/attendance/sessions/${id}`).then((r) => (r.ok ? apply(r.body.data) : setNotice({ ok: false, text: errorMessage(r) }))); }, [id]);

  const setStatus = (sid, status) => setMarks({ ...marks, [sid]: { ...marks[sid], status } });
  const allPresent = () => setMarks(Object.fromEntries(data.students.map((s) => [s.studentId, { ...marks[s.studentId], status: 'present' }])));
  const unmarked = data ? data.students.filter((s) => !marks[s.studentId]?.status).length : 0;

  const save = async () => {
    setBusy(true); setProblems([]); setNotice(null);
    const records = data.students.filter((s) => marks[s.studentId]?.status).map((s) => ({ studentId: s.studentId, status: marks[s.studentId].status, note: marks[s.studentId].note }));
    const r = await api(`/attendance/sessions/${id}/records`, { method: 'PUT', body: { records } });
    setBusy(false);
    if (r.ok) { apply(r.body.data); setNotice({ ok: true, text: 'Attendance saved.' }); }
    else { setProblems(fieldErrors(r).records || []); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const remove = async () => {
    setBusy(true);
    const r = await api(`/attendance/sessions/${id}`, { method: 'DELETE' });
    setBusy(false); setConfirm(false);
    if (r.ok) navigate(`/attendance/sections/${data.section.id}`, { replace: true }); else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!data) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const { section: s, session, canMark } = data;
  return (
    <section className="panel">
      <p><Link to={`/attendance/sections/${s.id}`}>Back to {s.courseCode} section {s.sectionCode}</Link></p>
      <h1>{session.date}{session.classNo > 1 ? `, class ${session.classNo}` : ''}</h1>
      <p>{s.courseCode}: {s.courseTitle}{session.topic ? ` · ${session.topic}` : ''}</p>
      {!canMark && <div className="alert alert-info" role="status">{data.editWindowDays ? `This class is older than ${data.editWindowDays} days, so only the office can change it.` : 'You can view this class but not change it.'}</div>}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {problems.length > 0 && <div className="alert alert-error"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}

      {data.students.length === 0 ? <p className="empty">Nobody is enrolled in this section.</p> : (
        <>
          {canMark && <p><button className="btn btn-quiet" onClick={allPresent}>Mark everyone present</button></p>}
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Student</th><th>Status</th></tr></thead>
            <tbody>{data.students.map((st) => (
              <tr key={st.studentId}>
                <td>{st.studentCode}<br />{st.fullName}</td>
                <td>
                  <div className="seg" role="radiogroup" aria-label={`Attendance for ${st.fullName}`}>
                    {OPTIONS.map(([v, l]) => (
                      <label key={v} className={marks[st.studentId]?.status === v ? `seg-on seg-${v}` : ''}>
                        <input type="radio" name={`s-${st.studentId}`} value={v} disabled={!canMark} checked={marks[st.studentId]?.status === v} onChange={() => setStatus(st.studentId, v)} /> {l}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          {canMark && (
            <div className="sticky-bar">
              <span>{unmarked === 0 ? 'Everyone is marked.' : `${unmarked} student(s) not marked yet.`}</span>
              <button className="btn btn-solid" onClick={save} disabled={busy || unmarked === data.students.length}>{busy ? 'Saving...' : 'Save attendance'}</button>
            </div>
          )}
          {canMark && <p><button className="btn btn-danger" onClick={() => setConfirm(true)}>Delete this class record</button></p>}
        </>
      )}
      <ConfirmDialog open={confirm} title="Delete this class?" message="All attendance marks for this class are deleted too." confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setConfirm(false)} />
    </section>
  );
}
