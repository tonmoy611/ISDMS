import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import useUniversityScope from '../components/useUniversityScope.jsx';

export default function EnrollmentList() {
  const { universityId, picker } = useUniversityScope();
  const [semesters, setSemesters] = useState([]);
  const [f, setF] = useState({ semesterId: '', status: '', q: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ loading: true });

  useEffect(() => { if (universityId) api(`/structure/semesters?pageSize=200&universityId=${universityId}`).then((r) => setSemesters(r.ok ? r.body.data.items : [])); }, [universityId]);
  useEffect(() => {
    if (!universityId) return;
    const qs = new URLSearchParams({ page, pageSize: 20, universityId, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    api(`/enrollment/registrations?${qs}`).then((r) => setData(r.ok ? { loading: false, ...r.body.data } : { loading: false, error: errorMessage(r) }));
  }, [universityId, applied, page]);

  return (
    <section className="panel">
      <h1>Enrollment</h1>
      {picker}
      {!universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
            <select aria-label="Semester" value={f.semesterId} onChange={(e) => setF({ ...f, semesterId: e.target.value })}>
              <option value="">All semesters</option>
              {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">Any status</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option>
            </select>
            <input aria-label="Search students" placeholder="Student ID or name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <button className="btn btn-quiet">Search</button>
          </form>
          {data.error && <div className="alert alert-error" role="alert">{data.error}</div>}
          {data.items && data.items.length === 0 && <p className="empty">No registrations match.</p>}
          {data.items && data.items.length > 0 && (
            <>
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Student</th><th>Semester</th><th>Courses</th><th>Credits</th><th>Status</th></tr></thead>
                <tbody>{data.items.map((r) => (
                  <tr key={r.id}><td><Link to={`/students/${r.studentPk}/enrollment`}>{r.fullName}</Link> ({r.studentId})</td><td>{r.semesterName}</td><td>{r.courses}</td><td>{r.credits}</td>
                    <td><span className={`badge badge-${r.status === 'confirmed' ? 'active' : 'blocked'}`}>{r.status}</span></td></tr>
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
