import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import { taka } from '../services/money.js';

export default function FinancePayments({ universityId }) {
  const [f, setF] = useState({ method: '', status: '', q: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams({ page, pageSize: 20, universityId, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) });
    api(`/finance/payments?${qs}`).then((r) => { if (r.ok) { setData(r.body.data); setError(''); } else setError(errorMessage(r)); });
  }, [universityId, applied, page]);
  return (
    <section>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
        <select aria-label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
          <option value="">Any method</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="sslcommerz">SSLCommerz</option><option value="bkash">bKash</option><option value="nagad">Nagad</option>
        </select>
        <select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Any status</option><option value="succeeded">Received</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option>
        </select>
        <input aria-label="Search" placeholder="Receipt, invoice, reference or student" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <button className="btn btn-quiet">Search</button>
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {data.items && data.items.length === 0 && <p className="empty">No payments.</p>}
      {data.items && data.items.length > 0 && (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
          <tbody>{data.items.map((p) => (
            <tr key={p.id}><td>{p.receiptNo || '-'}</td><td>{String(p.at).slice(0, 10)}</td><td>{p.studentName} ({p.studentCode})</td><td><Link to={`/finance/invoices/${p.invoiceId}`}>{p.invoiceNumber}</Link></td><td>{taka(p.amount)}</td><td>{p.method.replace('_', ' ')}</td><td>{p.status}</td></tr>
          ))}</tbody>
        </table></div>
      )}
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
