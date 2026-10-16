import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import useUniversityScope from '../components/useUniversityScope.jsx';
import Corrections from './Corrections.jsx';
import GradeScale from './GradeScale.jsx';

function SectionResults({ universityId }) {
  const [semesters, setSemesters] = useState([]);
  const [f, setF] = useState({ semesterId: '', status: '', q: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ loading: true });

  useEffect(() => { api(`/structure/semesters?pageSize=200&universityId=${universityId}`).then((r) => setSemesters(r.ok ? r.body.data.items : [])); }, [universityId]);
  useEffect(() => {
    const qs = new URLSearchParams({ page, pageSize: 20, universityId, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    api(`/results/sections?${qs}`).then((r) => setData(r.ok ? { loading: false, ...r.body.data } : { loading: false, error: errorMessage(r) }));
  }, [universityId, applied, page]);

  return (
    <section>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
        {semesters.length > 0 && (
          <select aria-label="Semester" value={f.semesterId} onChange={(e) => setF({ ...f, semesterId: e.target.value })}>
            <option value="">All semesters</option>{semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Any status</option><option value="draft">Draft</option><option value="submitted">Waiting for publication</option><option value="published">Published</option>
        </select>
        <input aria-label="Search courses" placeholder="Course code or title" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <button className="btn btn-quiet">Search</button>
      </form>
      {data.error && <div className="alert alert-error" role="alert">{data.error}</div>}
      {data.items && data.items.length === 0 && <p className="empty">No sections found.</p>}
      {data.items && data.items.length > 0 && (
        <>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Course</th><th>Section</th><th>Semester</th><th>Teacher</th><th>Students</th><th>Results</th></tr></thead>
            <tbody>{data.items.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/results/sections/${s.id}`}>{s.courseCode}</Link> {s.courseTitle}</td><td>{s.sectionCode}</td><td>{s.semesterName}</td><td>{s.teacherName || '-'}</td><td>{s.enrolled}</td>
                <td><span className={`badge badge-${s.status === 'published' ? 'active' : s.status === 'submitted' ? 'pending_verification' : 'inactive'}`}>{s.status === 'submitted' ? 'waiting' : s.status}</span></td>
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
    </section>
  );
}

export default function ResultsHome({ tab = 'sections' }) {
  const { can, isPlatform } = useAuth();
  const { universityId, picker, search } = useUniversityScope();
  return (
    <section className="panel">
      <h1>Results</h1>
      {picker}
      <nav className="tabs" aria-label="Result sections">
        <NavLink end to={`/results${search}`}>Sections</NavLink>
        {can('results.approve') && <NavLink to={`/results/corrections${search}`}>Corrections</NavLink>}
        {can('results.view') && <NavLink to={`/results/grade-scale${search}`}>Grading scale</NavLink>}
      </nav>
      {isPlatform && !universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          {tab === 'sections' && <SectionResults key={universityId} universityId={universityId} />}
          {tab === 'corrections' && <Corrections key={universityId} universityId={universityId} />}
          {tab === 'scale' && <GradeScale key={universityId} universityId={universityId} />}
        </>
      )}
    </section>
  );
}
