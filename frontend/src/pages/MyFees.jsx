import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import { taka } from '../services/money.js';
import InvoiceTable from '../components/InvoiceTable.jsx';

export default function MyFees() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/finance/me').then((r) => (r.ok ? setData(r.body.data) : setError(errorMessage(r)))); }, []);

  const receipt = async (paymentId) => {
    const r = await api('/documents/me/receipts', { method: 'POST', body: { paymentId } });
    if (r.ok) navigate(`/documents/${r.body.data.document.id}`); else setError(errorMessage(r));
  };

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <p className="page-loading" role="status">Loading...</p>;
  const t = data.totals;
  return (
    <section className="panel">
      <h1>My fees</h1>
      <div className="stat-row">
        <div className="stat"><span>Billed</span><strong>{taka(t.billed)}</strong></div>
        <div className="stat"><span>Paid</span><strong>{taka(t.paid)}</strong></div>
        <div className="stat"><span>Due</span><strong>{taka(t.due)}</strong></div>
        {t.overdue > 0 && <div className="stat stat-bad"><span>Overdue</span><strong>{taka(t.overdue)}</strong></div>}
      </div>
      {t.due > 0 && <p className="hint">Pay at the university accounts office and quote the invoice number. Online payment will be added soon.</p>}
      <h2>Invoices</h2>
      <InvoiceTable invoices={data.invoices} />
      <h2>Payments received</h2>
      {data.payments.length === 0 ? <p className="empty">No payments yet.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Receipt</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Date</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.payments.map((p) => (
            <tr key={p.id}><td>{p.receiptNo}</td><td>{p.invoiceNumber}</td><td>{taka(p.amount)}</td><td>{p.method.replace('_', ' ')}</td><td>{String(p.at).slice(0, 10)}</td>
              <td><button className="link-btn" onClick={() => receipt(p.id)}>Get receipt</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
