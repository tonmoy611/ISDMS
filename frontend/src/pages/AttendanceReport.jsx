import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import useUniversityScope from '../components/useUniversityScope.jsx';

export default function AttendanceReport() {
  const { can } = useAuth();
  const { universityId, picker } = useUniversityScope();
  const [semesters, setSemesters] = useState([]);
  const [f, setF] = useState({ semesterId: '', q: '', belowThreshold: true });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ loading: true });
  const [minPercent, setMinPercent] = useState('');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { if (universityId) api(`/structure/semesters?pageSize=200&universityId=${universityId}`).then((r) => setSemesters(r.ok ? r.body.data.items : [])); }, [universityId]);
  useEffect(() => {
    if (!universityId) return;
    const qs = new URLSearchParams({ page, pageSize: 25, universityId, ...(applied.semesterId ? { semesterId: applied.semesterId } : {}), ...(applied.q ? { q: applied.q } : {}), ...(applied.belowThreshold ? { belowThreshold: '1' } : {}) });
    api(`/attendance/report?${qs}`).then((r) => { if (r.ok) { setData({ loading: false, ...r.body.data }); setMinPercent(String(r.body.data.minPercent)); setError(''); } else { setData({ loading: false }); setError(errorMessage(r)); } });
  }, [universityId, applied, page]);

  const savePolicy = async (e) => {
    e.preventDefault(); setNotice(null);
    const r = await api('/attendance/policy', { method: 'PUT', body: { minPercent, universityId } });
    setNotice(r.ok ? { ok: true, text: 'Minimum attendance saved.' } : { ok: false, text: fieldErrors(r).minPercent || errorMessage(r) });
    if (r.ok) setApplied({ ...applied });
  };

  return (
    <section className="panel">
      <h1>Attendance report</h1>
      {picker}
      {!universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          {can('attendance.manage') && (
            <form className="filters" onSubmit={savePolicy}>
              <label htmlFor="minp">Minimum attendance (%)</label>
              <input id="minp" type="number" min="0" max="100" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} />
              <button className="btn btn-quiet">Save</button>
            </form>
          )}
          {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
          <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
            <select aria-label="Semester" value={f.semesterId} onChange={(e) => setF({ ...f, semesterId: e.target.value })}>
              <option value="">Current semester</option>
              {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input aria-label="Search students" placeholder="Student ID or name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <label className="check-inline"><input type="checkbox" checked={f.belowThreshold} onChange={(e) => setF({ ...f, belowThreshold: e.target.checked })} /> Only below the minimum</label>
            <button className="btn btn-quiet">Show</button>
          </form>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {data.items && data.items.length === 0 && <p className="empty">No students match.</p>}
          {data.items && data.items.length > 0 && (
            <>
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Student</th><th>Course</th><th>Attended</th><th>Absent</th><th>Attendance</th></tr></thead>
                <tbody>{data.items.map((r) => (
                  <tr key={`${r.studentPk}-${r.sectionId}`}>
                    <td><Link to={`/students/${r.studentPk}/attendance`}>{r.fullName}</Link> ({r.studentCode})</td>
                    <td><Link to={`/attendance/sections/${r.sectionId}`}>{r.courseCode} {r.sectionCode}</Link></td>
                    <td>{r.attended} of {r.counted}</td><td>{r.absent}</td>
                    <td>{r.percentage === null ? '-' : `${r.percentage}%`} {r.below && <span className="badge badge-blocked">Below</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="pager">
                <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total})</span>
                <button className="btn btn-quiet" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
