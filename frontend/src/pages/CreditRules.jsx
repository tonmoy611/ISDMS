import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export default function CreditRules({ universityId }) {
  const { can } = useAuth();
  const canManage = can('courses.manage');
  const [rules, setRules] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [f, setF] = useState({ programId: '', minCredits: '', maxCredits: '', totalCreditsRequired: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api(`/courses/credit-rules?universityId=${universityId}`);
    if (r.ok) setRules(r.body.data.rules); else setNotice({ ok: false, text: errorMessage(r) });
  }, [universityId]);
  useEffect(() => {
    load();
    api(`/structure/programs?pageSize=200&universityId=${universityId}`).then((r) => r.ok && setPrograms(r.body.data.items));
  }, [load, universityId]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api('/courses/credit-rules', { method: 'PUT', body: { ...f, universityId } });
    setBusy(false);
    if (r.ok) { setRules(r.body.data.rules); setNotice({ ok: true, text: 'Credit rule saved.' }); }
    else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const remove = async () => {
    setBusy(true);
    const r = await api(`/courses/credit-rules/${confirm.id}`, { method: 'DELETE' });
    setBusy(false); setConfirm(null);
    if (r.ok) { setNotice({ ok: true, text: 'Credit rule deleted.' }); load(); } else setNotice({ ok: false, text: errorMessage(r) });
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <section>
      <p className="hint">Credits a student may register per semester. A program rule overrides the university default.</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {rules.length === 0 ? <p className="empty">No credit rules yet. Without one, no credit limit is enforced.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Applies to</th><th>Minimum</th><th>Maximum</th><th>Total for degree</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}><td>{r.programName || 'University default'}</td><td>{r.minCredits}</td><td>{r.maxCredits}</td><td>{r.totalCreditsRequired ?? '-'}</td>
              {canManage && <td><button className="link-btn danger" onClick={() => setConfirm({ id: r.id })}>Delete</button></td>}</tr>
          ))}</tbody>
        </table></div>
      )}
      {canManage && (
        <form className="editor" onSubmit={save} noValidate>
          <h3>Add or change a rule</h3>
          <div className="field">
            <label htmlFor="rp">Applies to</label>
            <select id="rp" value={f.programId} onChange={set('programId')} aria-invalid={!!errors.programId}>
              <option value="">University default</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select>
            {errors.programId && <p className="field-error">{errors.programId}</p>}
          </div>
          <Field id="minCredits" label="Minimum credits per semester" type="number" step="0.5" value={f.minCredits} onChange={set('minCredits')} error={errors.minCredits} />
          <Field id="maxCredits" label="Maximum credits per semester" type="number" step="0.5" value={f.maxCredits} onChange={set('maxCredits')} error={errors.maxCredits} />
          <Field id="total" label="Total credits for the degree (optional)" type="number" step="0.5" value={f.totalCreditsRequired} onChange={set('totalCreditsRequired')} error={errors.totalCreditsRequired} />
          <button className="btn btn-solid" disabled={busy}>{busy ? 'Saving...' : 'Save rule'}</button>
        </form>
      )}
      <ConfirmDialog open={!!confirm} title="Delete this credit rule?" message="Students covered by it fall back to the university default, or to no limit if there is none." confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setConfirm(null)} />
    </section>
  );
}
