import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import useUniversityScope from '../components/useUniversityScope.jsx';
import DocumentTable from '../components/DocumentTable.jsx';

export default function DocumentsList() {
  const { universityId, picker } = useUniversityScope();
  const [f, setF] = useState({ q: '', type: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (!universityId) return;
    const qs = new URLSearchParams({ page, pageSize: 20, universityId, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    api(`/documents?${qs}`).then((r) => { if (r.ok) { setData(r.body.data); setError(''); } else setError(errorMessage(r)); });
  }, [universityId, applied, page]);
  return (
    <section className="panel">
      <h1>Issued documents</h1>
      {picker}
      {!universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
            <input aria-label="Search" placeholder="Serial, student ID or name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <select aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="">All types</option><option value="transcript">Transcript</option><option value="semester_result">Semester result</option><option value="admit_card">Admit card</option><option value="enrollment_confirmation">Enrollment confirmation</option>
            </select>
            <button className="btn btn-quiet">Search</button>
          </form>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {data.items && <DocumentTable documents={data.items} showStudent />}
          {data.pagination && data.items.length > 0 && (
            <div className="pager">
              <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total})</span>
              <button className="btn btn-quiet" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
