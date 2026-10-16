import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { taka } from '../services/money.js';
import Field from '../components/Field.jsx';
import InvoiceTable from '../components/InvoiceTable.jsx';

export default function StudentFinance() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const canManage = can('finance.manage');
  const [data, setData] = useState(null);
  const [semesters, setSemesters] = useState([]);
  const [heads, setHeads] = useState([]);
  const [inv, setInv] = useState({ type: 'semester', semesterId: '', dueDate: '' });
  const [con, setCon] = useState({ kind: 'scholarship', mode: 'percent', value: '', feeHeadId: '', semesterId: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api(`/finance/students/${id}`);
    if (!r.ok) { setNotice({ ok: false, text: errorMessage(r) }); return; }
    setData(r.body.data);
    if (canManage) {
      const s = await api(`/students/${id}`);
      if (s.ok) {
        const u = s.body.data.student.universityId;
        api(`/structure/semesters?pageSize=200&universityId=${u}`).then((x) => x.ok && setSemesters(x.body.data.items));
        api(`/finance/fee-heads?universityId=${u}`).then((x) => x.ok && setHeads(x.body.data.heads));
      }
    }
  }, [id, canManage]);
  useEffect(() => { load(); }, [load]);

  const createInvoice = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api(`/finance/students/${id}/invoices`, { method: 'POST', body: { type: inv.type, semesterId: inv.semesterId || undefined, dueDate: inv.dueDate || undefined } });
    setBusy(false);
    if (r.ok) navigate(`/finance/invoices/${r.body.data.invoice.id}`); else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const addConcession = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api(`/finance/students/${id}/concessions`, { method: 'POST', body: con });
    setBusy(false);
    if (r.ok) { setNotice({ ok: true, text: 'Saved. It applies to invoices created or recalculated from now on.' }); setCon({ ...con, value: '', reason: '' }); load(); } else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const revoke = async (cid) => {
    const r = await api(`/finance/students/${id}/concessions/${cid}/revoke`, { method: 'POST' });
    if (r.ok) load(); else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!data) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const t = data.totals;
  return (
    <section className="panel">
      <p><Link to={`/students/${id}`}>Back to student</Link></p>
      <h1>Fees: {data.student.fullName}</h1>
      <p>Student ID {data.student.studentId}</p>
      <div className="stat-row">
        <div className="stat"><span>Billed</span><strong>{taka(t.billed)}</strong></div>
        <div className="stat"><span>Paid</span><strong>{taka(t.paid)}</strong></div>
        <div className="stat"><span>Due</span><strong>{taka(t.due)}</strong></div>
        {t.overdue > 0 && <div className="stat stat-bad"><span>Overdue</span><strong>{taka(t.overdue)}</strong></div>}
      </div>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      <h2>Invoices</h2>
      <InvoiceTable invoices={data.invoices} />

      {canManage && (
        <form className="editor" onSubmit={createInvoice} noValidate>
          <h3>Create an invoice</h3>
          <div className="field"><label htmlFor="itype">Type</label><select id="itype" value={inv.type} onChange={(e) => setInv({ ...inv, type: e.target.value })}><option value="semester">Semester fees</option><option value="admission">Admission fees</option></select></div>
          {inv.type === 'semester' && (
            <div className="field"><label htmlFor="isem">Semester</label>
              <select id="isem" value={inv.semesterId} onChange={(e) => setInv({ ...inv, semesterId: e.target.value })}><option value="">Current semester</option>{semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          )}
          <Field id="idue" label="Due date (optional)" type="date" value={inv.dueDate} onChange={(e) => setInv({ ...inv, dueDate: e.target.value })} error={errors.dueDate} hint="Defaults to the university's standard number of days from today." />
          <button className="btn btn-solid" disabled={busy}>Create invoice</button>
        </form>
      )}

      <h2>Scholarships, discounts and waivers</h2>
      {data.concessions.length === 0 ? <p className="hint">None.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Type</th><th>Value</th><th>Applies to</th><th>Reason</th><th>Status</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{data.concessions.map((c) => (
            <tr key={c.id}><td>{c.kind}</td><td>{c.mode === 'percent' ? `${c.value}%` : taka(c.value)}</td><td>{c.feeHeadName || 'All charges'}{c.semesterName ? `, ${c.semesterName}` : ', every semester'}</td><td>{c.reason}</td><td>{c.status}</td>
              {canManage && <td>{c.status === 'active' && <button className="link-btn danger" onClick={() => revoke(c.id)}>Revoke</button>}</td>}</tr>
          ))}</tbody>
        </table></div>
      )}
      {canManage && (
        <form className="editor" onSubmit={addConcession} noValidate>
          <h3>Add a scholarship, discount or waiver</h3>
          <div className="field"><label htmlFor="ckind">Type</label><select id="ckind" value={con.kind} onChange={(e) => setCon({ ...con, kind: e.target.value })}><option value="scholarship">Scholarship</option><option value="discount">Discount</option><option value="waiver">Waiver</option></select></div>
          <div className="field"><label htmlFor="cmode">Given as</label><select id="cmode" value={con.mode} onChange={(e) => setCon({ ...con, mode: e.target.value })}><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select></div>
          <Field id="cval" label={con.mode === 'percent' ? 'Percent (1-100)' : 'Amount (BDT)'} inputMode="decimal" value={con.value} onChange={(e) => setCon({ ...con, value: e.target.value })} error={errors.value} />
          <div className="field"><label htmlFor="chead">Applies to</label><select id="chead" value={con.feeHeadId} onChange={(e) => setCon({ ...con, feeHeadId: e.target.value })}><option value="">All charges</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
          <div className="field"><label htmlFor="csem">Semester</label><select id="csem" value={con.semesterId} onChange={(e) => setCon({ ...con, semesterId: e.target.value })}><option value="">Every semester until revoked</option>{semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <Field id="creason" label="Reason" value={con.reason} onChange={(e) => setCon({ ...con, reason: e.target.value })} error={errors.reason} />
          <button className="btn btn-solid" disabled={busy}>Save</button>
        </form>
      )}
    </section>
  );
}
