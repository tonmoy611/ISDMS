import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import InvoiceTable from '../components/InvoiceTable.jsx';

export default function FinanceInvoices({ universityId }) {
  const [semesters, setSemesters] = useState([]);
  const [f, setF] = useState({ semesterId: '', state: '', q: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  useEffect(() => { api(`/structure/semesters?pageSize=200&universityId=${universityId}`).then((r) => setSemesters(r.ok ? r.body.data.items : [])); }, [universityId]);
  useEffect(() => {
    const qs = new URLSearchParams({ page, pageSize: 20, universityId, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    api(`/finance/invoices?${qs}`).then((r) => { if (r.ok) { setData(r.body.data); setError(''); } else setError(errorMessage(r)); });
  }, [universityId, applied, page]);
  return (
    <section>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
        <select aria-label="Semester" value={f.semesterId} onChange={(e) => setF({ ...f, semesterId: e.target.value })}><option value="">All semesters</option>{semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="Status" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
          <option value="">Any status</option><option value="unpaid">Unpaid</option><option value="partial">Partly paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
        </select>
        <input aria-label="Search" placeholder="Invoice no., student ID or name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <button className="btn btn-quiet">Search</button>
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {data.items && <InvoiceTable invoices={data.items} showStudent />}
      {data.pagination && data.items.length > 0 && (
        <div className="pager">
          <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total})</span>
          <button className="btn btn-quiet" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}
