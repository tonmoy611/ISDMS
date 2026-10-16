import { useEffect, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function GradeScale({ universityId }) {
  const { can } = useAuth();
  const canManage = can('results.manage');
  const [rows, setRows] = useState(null);
  const [notice, setNotice] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api(`/results/grade-scale?universityId=${universityId}`);
    if (r.ok) setRows(r.body.data.entries.map((e) => ({ ...e }))); else setNotice({ ok: false, text: errorMessage(r) });
  };
  useEffect(() => { load(); }, [universityId]); // eslint-disable-line

  const set = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setNotice(null); setProblems([]);
    const r = await api('/results/grade-scale', { method: 'PUT', body: { universityId, entries: rows } });
    setBusy(false);
    if (r.ok) { setRows(r.body.data.entries); setNotice({ ok: true, text: 'Grading scale saved. Results already published keep the grades they were given.' }); }
    else { setProblems(fieldErrors(r).entries || []); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const useDefault = async () => {
    setBusy(true);
    const r = await api('/results/grade-scale/default', { method: 'POST', body: { universityId } });
    setBusy(false);
    if (r.ok) { setRows(r.body.data.entries); setNotice({ ok: true, text: 'The standard 4.00 scale was loaded. Review it before using it.' }); } else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!rows) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  return (
    <section>
      <p className="hint">A mark earns the grade with the highest starting percentage that it reaches. Changing the scale does not change results that are already published.</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {problems.length > 0 && <div className="alert alert-error"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {rows.length === 0 && <p className="empty">No grading scale yet. Results cannot be submitted until one is set.</p>}
      {rows.length > 0 && (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Grade</th><th>From (%)</th><th>Grade point</th><th>Pass</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{rows.map((e, i) => (
            <tr key={i}>
              <td><input aria-label={`Grade ${i + 1}`} className="cell-input" value={e.letter} disabled={!canManage} onChange={(ev) => set(i, { letter: ev.target.value })} /></td>
              <td><input aria-label={`From percent ${i + 1}`} className="cell-input" type="number" step="0.01" value={e.minPercent} disabled={!canManage} onChange={(ev) => set(i, { minPercent: ev.target.value })} /></td>
              <td><input aria-label={`Grade point ${i + 1}`} className="cell-input" type="number" step="0.01" value={e.gradePoint} disabled={!canManage} onChange={(ev) => set(i, { gradePoint: ev.target.value })} /></td>
              <td><input type="checkbox" aria-label={`Pass ${i + 1}`} checked={!!e.isPass} disabled={!canManage} onChange={(ev) => set(i, { isPass: ev.target.checked })} /></td>
              {canManage && <td><button className="link-btn danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {canManage && (
        <div className="btn-row">
          <button className="btn btn-quiet" onClick={() => setRows([...rows, { letter: '', minPercent: '', gradePoint: '', isPass: true }])}>Add grade</button>
          {rows.length === 0 && <button className="btn btn-quiet" onClick={useDefault} disabled={busy}>Load the standard 4.00 scale</button>}
          <button className="btn btn-solid" onClick={save} disabled={busy || rows.length === 0}>{busy ? 'Saving...' : 'Save scale'}</button>
        </div>
      )}
    </section>
  );
}
