import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { taka } from '../services/money.js';
import Field from '../components/Field.jsx';
import StateBadge from '../components/StateBadge.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 40);

export default function InvoiceDetail() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const isStudent = user.role === 'student';
  const [d, setD] = useState(null);
  const [notice, setNotice] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '', note: '', key: newKey() });
  const [adj, setAdj] = useState({ description: '', amount: '' });
  const [plan, setPlan] = useState({ count: '3', firstDueDate: '', intervalDays: '30' });
  const [cancelReason, setCancelReason] = useState('');
  const [confirm, setConfirm] = useState(null);

  const apply = useCallback((data) => { setD(data); setPay((p) => ({ ...p, amount: String(data.invoice.balance || ''), key: newKey() })); }, []);
  useEffect(() => { api(`/finance/invoices/${id}`).then((r) => (r.ok ? apply(r.body.data) : setNotice({ ok: false, text: errorMessage(r) }))); }, [id, apply]);

  const call = async (path, method, body, okText) => {
    setBusy(true); setNotice(null); setErrors({}); setConfirm(null);
    const r = await api(`/finance/invoices/${id}/${path}`, { method, body });
    setBusy(false);
    if (r.ok) { apply(r.body.data); setNotice({ ok: true, text: okText }); return true; }
    setErrors(fieldErrors(r)); setNotice({ ok: false, text: [errorMessage(r), ...(fieldErrors(r).installments || [])].join(' ') });
    return false;
  };
  const receipt = async (paymentId) => {
    const url = isStudent ? '/documents/me/receipts' : `/documents/students/${d.invoice.student.id}/receipts`;
    const r = await api(url, { method: 'POST', body: { paymentId } });
    if (r.ok) navigate(`/documents/${r.body.data.document.id}`); else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!d) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const inv = d.invoice;
  const open = inv.state !== 'cancelled' && inv.state !== 'paid';
  const back = isStudent ? '/my-fees' : `/students/${inv.student.id}/finance`;

  return (
    <section className="panel">
      <p><Link to={back}>Back</Link></p>
      <h1>Invoice {inv.number}</h1>
      <p>{inv.student.name} ({inv.student.code}) · {inv.type === 'semester' ? inv.semesterName : inv.type === 'admission' ? 'Admission' : 'Other'} · issued {inv.issueDate} · <StateBadge state={inv.state} /></p>
      {inv.state === 'cancelled' && <div className="alert alert-error">Cancelled: {inv.cancelReason}</div>}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      <div className="stat-row">
        <div className="stat"><span>Total</span><strong>{taka(inv.total)}</strong></div>
        <div className="stat"><span>Paid</span><strong>{taka(inv.paid)}</strong></div>
        <div className="stat"><span>Balance</span><strong>{taka(inv.balance)}</strong></div>
        {open && <div className="stat"><span>Next due</span><strong>{inv.nextDueDate || inv.dueDate}</strong></div>}
      </div>

      <h2>Charges</h2>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Description</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>{d.lines.map((l) => (
          <tr key={l.id}><td>{l.description}{l.kind === 'late_fee' && ' (late fee)'}</td><td>{l.kind === 'charge' ? l.quantity : ''}</td><td>{l.kind === 'charge' ? taka(l.unitAmount) : ''}</td><td className={l.amount < 0 ? 'neg' : ''}>{taka(l.amount)}</td></tr>
        ))}</tbody>
        <tfoot><tr><th colSpan="3">Total</th><th>{taka(inv.total)}</th></tr></tfoot>
      </table></div>

      {d.installments.length > 0 && (
        <>
          <h2>Installments</h2>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Covered</th><th>Status</th></tr></thead>
            <tbody>{d.installments.map((i) => <tr key={i.seq}><td>{i.seq}</td><td>{i.dueDate}</td><td>{taka(i.amount)}</td><td>{taka(i.covered)}</td><td>{i.status}{i.overdue && ' (overdue)'}</td></tr>)}</tbody>
          </table></div>
        </>
      )}

      <h2>Payments</h2>
      {d.payments.length === 0 ? <p className="hint">No payments yet.{isStudent && inv.balance > 0 ? ' Pay at the accounts office and quote the invoice number.' : ''}</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.payments.map((p) => (
            <tr key={p.id}><td>{p.receiptNo || '-'}</td><td>{String(p.at).slice(0, 10)}</td><td>{taka(p.amount)}</td><td>{p.method.replace('_', ' ')}{p.reference ? ` (${p.reference})` : ''}</td><td>{p.status}</td>
              <td>{p.status === 'succeeded' && (isStudent || can('documents.issue') || can('finance.collect')) && <button className="link-btn" onClick={() => receipt(p.id)}>Receipt</button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      {!isStudent && open && can('finance.collect') && (
        <form className="editor" onSubmit={(e) => { e.preventDefault(); call('payments', 'POST', { amount: pay.amount, method: pay.method, reference: pay.reference, note: pay.note, idempotencyKey: pay.key }, 'Payment recorded.'); }} noValidate>
          <h3>Record a payment received</h3>
          <Field id="pamount" label="Amount (BDT)" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} error={errors.amount} />
          <div className="field"><label htmlFor="pmethod">Method</label>
            <select id="pmethod" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></div>
          <Field id="pref" label="Reference (bank slip, cheque number)" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} error={errors.reference} />
          <Field id="pnote" label="Note (optional)" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} error={errors.note} />
          <button className="btn btn-solid" disabled={busy}>{busy ? 'Saving...' : 'Record payment'}</button>
        </form>
      )}

      {!isStudent && can('finance.manage') && open && (
        <>
          <h2>Manage this invoice</h2>
          <div className="btn-row">
            {d.invoice.paid === 0 && inv.type !== 'other' && <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirm({ title: 'Recalculate this invoice?', text: 'Charges and discounts are rebuilt from the current fee structure and registration. Adjustments and late fees stay. Any installment plan is removed.', label: 'Recalculate', run: () => call('recalculate', 'POST', undefined, 'Invoice recalculated.') })}>Recalculate</button>}
          </div>
          <form className="editor" onSubmit={(e) => { e.preventDefault(); call('adjustments', 'POST', adj, 'Adjustment added.').then((okd) => okd && setAdj({ description: '', amount: '' })); }} noValidate>
            <h3>Add an adjustment</h3>
            <Field id="adesc" label="Description" value={adj.description} onChange={(e) => setAdj({ ...adj, description: e.target.value })} error={errors.description} />
            <Field id="aamt" label="Amount (negative reduces the invoice)" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} error={errors.amount} />
            <button className="btn btn-solid" disabled={busy}>Add adjustment</button>
          </form>
          <form className="editor" onSubmit={(e) => { e.preventDefault(); call('installments', 'PUT', plan, 'Installment plan saved.'); }} noValidate>
            <h3>Installment plan</h3>
            <p className="hint">Splits the invoice total into equal parts. Payments cover the installments in order.</p>
            <Field id="icount" label="Number of installments (2-12)" type="number" value={plan.count} onChange={(e) => setPlan({ ...plan, count: e.target.value })} />
            <Field id="ifirst" label="First due date" type="date" value={plan.firstDueDate} onChange={(e) => setPlan({ ...plan, firstDueDate: e.target.value })} />
            <Field id="iint" label="Days between installments" type="number" value={plan.intervalDays} onChange={(e) => setPlan({ ...plan, intervalDays: e.target.value })} />
            <div className="btn-row">
              <button className="btn btn-solid" disabled={busy}>Save plan</button>
              {d.installments.length > 0 && <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => call('installments', 'PUT', { installments: [] }, 'Installment plan removed.')}>Remove plan</button>}
            </div>
          </form>
          <h3>Cancel invoice</h3>
          <div className="field narrow-panel"><label htmlFor="creason">Reason</label><input id="creason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />{errors.reason && <p className="field-error">{errors.reason}</p>}</div>
          <button className="btn btn-danger" disabled={busy || cancelReason.trim().length < 5} onClick={() => setConfirm({ title: 'Cancel this invoice?', text: 'This cannot be undone. Only invoices without payments can be cancelled.', label: 'Cancel invoice', danger: true, run: () => call('cancel', 'POST', { reason: cancelReason }, 'Invoice cancelled.') })}>Cancel invoice</button>
        </>
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.text || ''} confirmLabel={confirm?.label} danger={confirm?.danger} busy={busy} onConfirm={() => confirm.run()} onCancel={() => setConfirm(null)} />
    </section>
  );
}
