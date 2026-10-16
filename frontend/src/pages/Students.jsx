import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { statusLabel } from './Users.jsx';

export default function Students() {
  const { can, isPlatform } = useAuth();
  const [unis, setUnis] = useState([]);
  const [uni, setUni] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', academicStatus: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true });

  useEffect(() => { if (isPlatform) api('/universities?pageSize=200').then((r) => r.ok && setUnis(r.body.data.items)); }, [isPlatform]);
  useEffect(() => {
    let alive = true;
    if (isPlatform && !uni) { setState({ loading: false, items: [], pagination: { page: 1, totalPages: 1, total: 0 } }); return undefined; }
    const qs = new URLSearchParams({ page, pageSize: 20, ...(uni ? { universityId: uni } : {}), ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    setState((s) => ({ ...s, loading: true }));
    api(`/students?${qs}`).then((r) => alive && setState(r.ok ? { loading: false, ...r.body.data } : { loading: false, error: errorMessage(r) }));
    return () => { alive = false; };
  }, [applied, page, uni, isPlatform]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Students</h1>
        {can('students.create') && <Link className="btn btn-solid" to="/students/new">Register student</Link>}
      </div>
      {isPlatform && (
        <div className="field narrow-panel">
          <label htmlFor="uni">University</label>
          <select id="uni" value={uni} onChange={(e) => { setUni(e.target.value); setPage(1); }}>
            <option value="">Choose a university</option>
            {unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}>
        <input aria-label="Search students" placeholder="Search name, student ID, email or phone" value={filters.q} onChange={set('q')} />
        <select aria-label="Account status" value={filters.status} onChange={set('status')}>
          <option value="">Any account status</option>
          {Object.entries(statusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Academic status" value={filters.academicStatus} onChange={set('academicStatus')}>
          <option value="">Any academic status</option>
          {['studying', 'graduated', 'withdrawn', 'suspended'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-quiet">Search</button>
      </form>
      {state.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      {isPlatform && !uni && <p className="empty">Choose a university to see its students.</p>}
      {state.loading && !state.items && <p className="hint" role="status">Loading...</p>}
      {state.items && state.items.length === 0 && (!isPlatform || uni) && <p className="empty">No students match.</p>}
      {state.items && state.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Student ID</th><th>Name</th><th>Program</th><th>Batch</th><th>Semester</th><th>Account</th></tr></thead>
              <tbody>
                {state.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.studentId}</td>
                    <td><Link to={`/students/${s.id}`}>{s.fullName}</Link></td>
                    <td>{s.programName}</td><td>{s.batchName}</td><td>{s.semesterName}</td>
                    <td><span className={`badge badge-${s.accountStatus}`}>{statusLabel[s.accountStatus]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {state.pagination.page} of {state.pagination.totalPages} ({state.pagination.total} students)</span>
            <button className="btn btn-quiet" disabled={page >= state.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}
