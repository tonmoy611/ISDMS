import { useEffect, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { taka } from '../services/money.js';
import Field from '../components/Field.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export default function FinanceOverview({ universityId }) {
  const { can } = useAuth();
  const canManage = can('finance.manage');
  const [semesters, setSemesters] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [semesterId, setSemesterId] = useState('');
  const [data, setData] = useState(null);
  const [gen, setGen] = useState({ semesterId: '', programId: '', dueDate: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');

  const load = () => api(`/finance/summary?universityId=${universityId}${semesterId ? `&semesterId=${semesterId}` : ''}`).then((r) => { if (r.ok) { setData(r.body.data); setError(''); } else setError(errorMessage(r)); });
  useEffect(() => { load(); }, [universityId, semesterId]); // eslint-disable-line
  useEffect(() => {
    api(`/structure/semesters?pageSize=200&universityId=${universityId}`).then((r) => setSemesters(r.ok ? r.body.data.items : []));
    api(`/structure/programs?pageSize=200&universityId=${universityId}`).then((r) => setPrograms(r.ok ? r.body.data.items : []));
  }, [universityId]);

  const generate = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null); setReport(null);
    const r = await api('/finance/invoices/generate-semester', { method: 'POST', body: { universityId, semesterId: gen.semesterId, programId: gen.programId || undefined, dueDate: gen.dueDate || undefined } });
    setBusy(false);
    if (r.ok) { setReport(r.body.data); load(); } else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const assess = async () => {
    setBusy(true); setConfirm(false); setNotice(null);
    const r = await api('/finance/late-fees/assess', { method: 'POST', body: { universityId, semesterId: semesterId || undefined } });
    setBusy(false);
    setNotice(r.ok ? { ok: true, text: `Late fees were added to ${r.body.data.assessed} invoice(s), ${taka(r.body.data.total)} in total.` } : { ok: false, text: errorMessage(r) });
    if (r.ok) load();
  };

  return (
    <section>
      <div className="filters">
        <select aria-label="Semester" value={semesterId} onChange={(e) => setSemesterId(e.target.value)}>
          <option value="">All semesters</option>{semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {data && (
        <>
          <div className="stat-row">
            <div className="stat"><span>Billed</span><strong>{taka(data.billed)}</strong></div>
            <div className="stat"><span>Collected</span><strong>{taka(data.collected)}</strong></div>
            <div className="stat"><span>Outstanding</span><strong>{taka(data.outstanding)}</strong></div>
            <div className="stat stat-bad"><span>Overdue</span><strong>{taka(data.overdueAmount)}</strong></div>
          </div>
          <p>{data.invoices} invoices: {data.counts.paid} paid, {data.counts.open} open, {data.counts.overdue} overdue.</p>
          {data.byMethod.length > 0 && <p className="hint">Received by method: {data.byMethod.map((m) => `${m.method.replace('_', ' ')} ${taka(m.total)} (${m.payments})`).join(' · ')}</p>}
        </>
      )}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {canManage && (
        <>
          <form className="editor" onSubmit={generate} noValidate>
            <h3>Create semester invoices for everyone registered</h3>
            <p className="hint">Students who already have an invoice for the semester are skipped. Fees follow the program's fee structure and each student's registered credits.</p>
            <div className="field"><label htmlFor="gsem">Semester</label>
              <select id="gsem" value={gen.semesterId} onChange={(e) => setGen({ ...gen, semesterId: e.target.value })} aria-invalid={!!errors.semesterId}><option value="">Choose a semester</option>{semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              {errors.semesterId && <p className="field-error">{errors.semesterId}</p>}</div>
            <div className="field"><label htmlFor="gprog">Program (optional)</label>
              <select id="gprog" value={gen.programId} onChange={(e) => setGen({ ...gen, programId: e.target.value })}><option value="">All programs</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
            <Field id="gdue" label="Due date (optional)" type="date" value={gen.dueDate} onChange={(e) => setGen({ ...gen, dueDate: e.target.value })} error={errors.dueDate} />
            <button className="btn btn-solid" disabled={busy || !gen.semesterId}>{busy ? 'Working...' : 'Create invoices'}</button>
          </form>
          {report && (
            <div className="alert alert-info" role="status">
              {report.created} invoice(s) created, {report.alreadyInvoiced} already had one, {report.skipped} skipped.
              {report.problems.length > 0 && <ul>{report.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
          <h3>Late fees</h3>
          <p className="hint">Adds the late fee, once, to every invoice that is past its due date plus the grace period. Run this when you want it (for example each week). Set the rule under Setup.</p>
          <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirm(true)}>Add late fees now</button>
          <ConfirmDialog open={confirm} title="Add late fees?" message="Every overdue invoice without a late fee gets one now. This changes what students owe." confirmLabel="Add late fees" busy={busy} onConfirm={assess} onCancel={() => setConfirm(false)} />
        </>
      )}
    </section>
  );
}
