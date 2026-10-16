import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export const roleLabel = { super_admin: 'Super Admin', teacher: 'Teacher', staff: 'Staff', student: 'Student' };
export const statusLabel = { active: 'Active', blocked: 'Blocked', inactive: 'Inactive', pending_verification: 'Awaiting verification' };
const fmt = (d) => (d ? new Date(d).toLocaleString() : 'Never');

export default function Users() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', role: '', status: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const qs = new URLSearchParams({ page, pageSize: 20, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    api(`/users?${qs}`).then((r) => {
      if (!alive) return;
      setState(r.ok ? { loading: false, ...r.body.data } : { loading: false, error: errorMessage(r) });
    });
    return () => { alive = false; };
  }, [applied, page]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const search = (e) => { e.preventDefault(); setPage(1); setApplied(filters); };

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Users</h1>
        {can('users.create') && <Link className="btn btn-solid" to="/users/new">Add user</Link>}
      </div>
      <form className="filters" onSubmit={search}>
        <input aria-label="Search users" placeholder="Search name, login ID, email or phone" value={filters.q} onChange={set('q')} />
        <select aria-label="Filter by role" value={filters.role} onChange={set('role')}>
          <option value="">All roles</option>
          {Object.entries(roleLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Filter by status" value={filters.status} onChange={set('status')}>
          <option value="">All statuses</option>
          {Object.entries(statusLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn btn-quiet">Search</button>
      </form>

      {state.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      {state.loading && !state.items && <p className="hint" role="status">Loading users...</p>}
      {state.items && state.items.length === 0 && <p className="empty">No users match these filters.</p>}
      {state.items && state.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Login ID</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
              <tbody>
                {state.items.map((u) => (
                  <tr key={u.id}>
                    <td><Link to={`/users/${u.id}`}>{u.fullName}</Link></td>
                    <td>{u.loginId}</td>
                    <td>{roleLabel[u.role] || u.role}</td>
                    <td><span className={`badge badge-${u.status}`}>{statusLabel[u.status] || u.status}</span></td>
                    <td>{fmt(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {state.pagination.page} of {state.pagination.totalPages} ({state.pagination.total} users)</span>
            <button className="btn btn-quiet" disabled={page >= state.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}
