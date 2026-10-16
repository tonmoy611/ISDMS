import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';

const CALC = { fixed: 'Fixed amount', per_credit: 'Per credit', per_course: 'Per course', per_lab_course: 'Per lab course' };

function Heads({ universityId, canManage, onChange }) {
  const [heads, setHeads] = useState([]);
  const [f, setF] = useState({ code: '', name: '', calcType: 'fixed', appliesTo: 'semester' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => { const r = await api(`/finance/fee-heads?universityId=${universityId}`); if (r.ok) { setHeads(r.body.data.heads); onChange?.(r.body.data.heads); } }, [universityId]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault(); setErrors({}); setNotice(null);
    const r = await api('/finance/fee-heads', { method: 'POST', body: { ...f, universityId } });
    if (r.ok) { setF({ ...f, code: '', name: '' }); load(); } else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const toggle = async (h) => {
    const r = await api(`/finance/fee-heads/${h.id}`, { method: 'PATCH', body: { status: h.status === 'active' ? 'inactive' : 'active' } });
    if (r.ok) load(); else setNotice({ ok: false, text: errorMessage(r) });
  };
  return (
    <div>
      <h2>Kinds of fees</h2>
      <p className="hint">For example Tuition per credit, Semester fee, Lab fee, Library, Exam, Transport. A fee on "admission" is charged once, on the admission invoice.</p>
      {notice && <div className="alert alert-error" role="alert">{notice.text}</div>}
      {heads.length === 0 ? <p className="empty">No fees yet.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Charged</th><th>When</th><th>Status</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{heads.map((h) => (
            <tr key={h.id}><td>{h.code}</td><td>{h.name}</td><td>{CALC[h.calcType]}</td><td>{h.appliesTo === 'admission' ? 'At admission' : 'Every semester'}</td><td><span className={`badge badge-${h.status}`}>{h.status}</span></td>
              {canManage && <td><button className="link-btn" onClick={() => toggle(h)}>{h.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>}</tr>
          ))}</tbody>
        </table></div>
      )}
      {canManage && (
        <form className="editor" onSubmit={add} noValidate>
          <h3>Add a fee</h3>
          <Field id="hcode" label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={errors.code} hint="For example TUITION." />
          <Field id="hname" label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} />
          <div className="field"><label htmlFor="hcalc">How it is charged</label><select id="hcalc" value={f.calcType} onChange={(e) => setF({ ...f, calcType: e.target.value })}>{Object.entries(CALC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="happ">When</label><select id="happ" value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}><option value="semester">Every semester</option><option value="admission">At admission</option></select></div>
          <button className="btn btn-solid">Add fee</button>
        </form>
      )}
    </div>
  );
}

function Schedule({ universityId, canManage, heads }) {
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState('');
  const [rows, setRows] = useState([]);
  const [defaults, setDefaults] = useState([]);
  const [notice, setNotice] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/structure/programs?pageSize=200&universityId=${universityId}`).then((r) => setPrograms(r.ok ? r.body.data.items : [])); }, [universityId]);
  const load = useCallback(async () => {
    const r = await api(`/finance/fee-schedule?universityId=${universityId}${programId ? `&programId=${programId}` : ''}`);
    if (r.ok) { setRows(r.body.data.items.map((i) => ({ feeHeadId: i.feeHeadId, amount: i.amount }))); setDefaults(r.body.data.defaultItems); }
  }, [universityId, programId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setNotice(null); setProblems([]);
    const r = await api('/finance/fee-schedule', { method: 'PUT', body: { universityId, programId: programId || null, items: rows } });
    setBusy(false);
    if (r.ok) setNotice({ ok: true, text: 'Saved. Invoices that already exist are not changed; recalculate them if needed.' });
    else { setProblems(fieldErrors(r).items || []); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const set = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <div>
      <h2>Fee amounts</h2>
      <p className="hint">Set the amounts for the whole university, or for one program. A program's own amount replaces the university amount for that fee. Rates for "per credit", "per course" and "per lab course" fees are per unit.</p>
      <div className="field narrow-panel"><label htmlFor="sp">Applies to</label>
        <select id="sp" value={programId} onChange={(e) => setProgramId(e.target.value)}><option value="">University default</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
      {programId && defaults.length > 0 && <p className="hint">University default: {defaults.map((d) => `${d.name} ${d.amount}`).join(', ')}</p>}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {problems.length > 0 && <div className="alert alert-error"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {rows.map((r, i) => (
        <div className="curr-row" key={i}>
          <select aria-label={`Fee ${i + 1}`} value={r.feeHeadId} disabled={!canManage} onChange={(e) => set(i, { feeHeadId: e.target.value })}>
            <option value="">Choose a fee</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name} ({CALC[h.calcType].toLowerCase()})</option>)}
          </select>
          <input aria-label={`Amount ${i + 1}`} className="cell-input" inputMode="decimal" value={r.amount} disabled={!canManage} onChange={(e) => set(i, { amount: e.target.value })} />
          {canManage && <button className="link-btn danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</button>}
        </div>
      ))}
      {canManage && <div className="btn-row"><button className="btn btn-quiet" onClick={() => setRows([...rows, { feeHeadId: '', amount: '' }])}>Add line</button><button className="btn btn-solid" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save amounts'}</button></div>}
    </div>
  );
}

function Settings({ universityId, canManage }) {
  const [s, setS] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/finance/settings?universityId=${universityId}`).then((r) => r.ok && setS({ ...r.body.data, lateCap: r.body.data.lateCap ?? '' })); }, [universityId]);
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api('/finance/settings', { method: 'PUT', body: { ...s, universityId } });
    setBusy(false);
    if (r.ok) { setS({ ...r.body.data, lateCap: r.body.data.lateCap ?? '' }); setNotice({ ok: true, text: 'Settings saved.' }); } else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  return (
    <form className="editor" onSubmit={save} noValidate>
      <h3>Due dates, late fees and clearance</h3>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      <Field id="sdue" label="Days from issue to due date" type="number" value={s.defaultDueDays} disabled={!canManage} onChange={set('defaultDueDays')} error={errors.defaultDueDays} />
      <div className="field"><label htmlFor="slate">Late fee</label>
        <select id="slate" value={s.lateMode} disabled={!canManage} onChange={set('lateMode')}><option value="none">None</option><option value="flat">Fixed amount</option><option value="percent">Percent of the unpaid balance</option></select></div>
      {s.lateMode !== 'none' && (
        <>
          <Field id="sval" label={s.lateMode === 'percent' ? 'Percent' : 'Amount (BDT)'} inputMode="decimal" value={s.lateValue} disabled={!canManage} onChange={set('lateValue')} error={errors.lateValue} />
          <Field id="sgrace" label="Grace days after the due date" type="number" value={s.lateGraceDays} disabled={!canManage} onChange={set('lateGraceDays')} error={errors.lateGraceDays} />
          <Field id="scap" label="Highest late fee (optional)" inputMode="decimal" value={s.lateCap} disabled={!canManage} onChange={set('lateCap')} error={errors.lateCap} />
        </>
      )}
      <label className="check-inline"><input type="checkbox" checked={s.admitCardRequiresClearance} disabled={!canManage} onChange={set('admitCardRequiresClearance')} /> Admit cards need fee clearance (no overdue fees)</label>
      {canManage && <button className="btn btn-solid" disabled={busy}>{busy ? 'Saving...' : 'Save settings'}</button>}
    </form>
  );
}

export default function FinanceSetup({ universityId }) {
  const { can } = useAuth();
  const canManage = can('finance.manage');
  const [heads, setHeads] = useState([]);
  return (
    <section>
      <Heads universityId={universityId} canManage={canManage} onChange={setHeads} />
      <Schedule universityId={universityId} canManage={canManage} heads={heads.filter((h) => h.status === 'active')} />
      <Settings universityId={universityId} canManage={canManage} />
    </section>
  );
}
