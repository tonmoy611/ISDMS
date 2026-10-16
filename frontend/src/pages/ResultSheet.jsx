import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const sum = (comps, cells) => comps.reduce((a, c) => a + (Number(cells?.[c.id]) || 0), 0);

export default function ResultSheet() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [parts, setParts] = useState([]);
  const [grid, setGrid] = useState({});
  const [notice, setNotice] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [fix, setFix] = useState(null); // correction form
  const [hist, setHist] = useState(null);

  const apply = useCallback((d) => {
    setData(d); setParts(d.components.map((c) => ({ ...c })));
    setGrid(Object.fromEntries(d.students.map((s) => [s.enrollmentId, Object.fromEntries(d.components.map((c) => [c.id, s.marks[c.id] ?? '']))])));
  }, []);
  useEffect(() => { api(`/results/sections/${id}/sheet`).then((r) => (r.ok ? apply(r.body.data) : setNotice({ ok: false, text: errorMessage(r) }))); }, [id, apply]);

  const call = async (path, method, body, okText) => {
    setBusy(true); setNotice(null); setProblems([]); setConfirm(null);
    const r = await api(`/results/sections/${id}/${path}`, { method, body });
    setBusy(false);
    if (r.ok) { apply(r.body.data); setNotice({ ok: true, text: okText }); return true; }
    const d = fieldErrors(r);
    setProblems([...(d.components || []), ...(d.marks || []), ...(d.missing || [])]); setNotice({ ok: false, text: errorMessage(r) });
    return false;
  };
  const saveParts = () => call('components', 'PUT', { components: parts }, 'Assessment parts saved.');
  const saveMarks = () => call('marks', 'PUT', { entries: data.students.flatMap((s) => data.components.map((c) => ({ enrollmentId: s.enrollmentId, componentId: c.id, marks: grid[s.enrollmentId]?.[c.id] ?? '' }))) }, 'Marks saved.');

  const sendCorrection = async (e) => {
    e.preventDefault(); setBusy(true); setNotice(null); setProblems([]);
    const r = await api(`/results/entries/${fix.resultId}/corrections`, { method: 'POST', body: { reason: fix.reason, changes: data.components.map((c) => ({ componentId: c.id, marks: fix.marks[c.id] })) } });
    setBusy(false);
    if (r.ok) { setFix(null); setNotice({ ok: true, text: 'Correction sent for approval. The published result stays as it is until it is approved.' }); api(`/results/sections/${id}/sheet`).then((s) => s.ok && apply(s.body.data)); }
    else { setProblems(fieldErrors(r).changes || []); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const showHistory = async (resultId) => {
    const r = await api(`/results/entries/${resultId}/history`);
    if (r.ok) setHist(r.body.data.versions); else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!data) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const { section: s, batch, can } = data;
  const published = batch.status === 'published';

  return (
    <section className="panel">
      <p><Link to="/results">Back to results</Link></p>
      <h1>{s.courseCode} section {s.sectionCode}</h1>
      <p>{s.courseTitle} · {s.semesterName} · {s.credit} credits · <span className={`badge badge-${published ? 'active' : batch.status === 'submitted' ? 'pending_verification' : 'inactive'}`}>{batch.status === 'submitted' ? 'waiting for publication' : batch.status}</span></p>
      {data.scaleMissing && <div className="alert alert-info">The grading scale is not set up yet, so grades are not shown and results cannot be submitted.</div>}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {problems.length > 0 && <div className="alert alert-error"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}

      <h2>Assessment parts</h2>
      {can.edit ? (
        <>
          <p className="hint">For example Quiz 20, Midterm 30, Final 50. Percentage is total marks divided by the sum of the maximums. Removing a part deletes its marks.</p>
          {parts.map((p, i) => (
            <div className="curr-row" key={p.id ?? `n${i}`}>
              <input aria-label={`Name of part ${i + 1}`} className="cell-input wide" value={p.name} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label={`Maximum marks of part ${i + 1}`} className="cell-input" type="number" step="0.01" value={p.maxMarks} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, maxMarks: e.target.value } : x)))} />
              <button className="link-btn danger" onClick={() => setParts(parts.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn btn-quiet" onClick={() => setParts([...parts, { name: '', maxMarks: '' }])}>Add part</button>
            <button className="btn btn-solid" onClick={saveParts} disabled={busy || parts.length === 0}>Save parts</button>
          </div>
        </>
      ) : <p>{data.components.map((c) => `${c.name} (${c.maxMarks})`).join(', ') || 'None yet.'}</p>}

      <h2>Marks</h2>
      {data.components.length === 0 ? <p className="empty">Add the assessment parts first.</p> : data.students.length === 0 ? <p className="empty">Nobody is enrolled in this section.</p> : (
        <>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Student</th>{data.components.map((c) => <th key={c.id}>{c.name} /{c.maxMarks}</th>)}<th>Total</th><th>Grade</th>{published && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>{data.students.map((st) => {
              const cells = grid[st.enrollmentId];
              const shown = published ? st.result : null;
              return (
                <tr key={st.enrollmentId}>
                  <td>{st.studentCode}<br />{st.fullName}</td>
                  {data.components.map((c) => (
                    <td key={c.id}>{can.edit
                      ? <input aria-label={`${c.name} for ${st.fullName}`} className="cell-input" inputMode="decimal" value={cells?.[c.id] ?? ''} onChange={(e) => setGrid({ ...grid, [st.enrollmentId]: { ...cells, [c.id]: e.target.value } })} />
                      : (st.marks[c.id] ?? '-')}</td>
                  ))}
                  <td>{shown ? `${shown.totalMarks} (${shown.percentage}%)` : sum(data.components, cells)}</td>
                  <td>{shown ? <strong>{shown.letterGrade} ({shown.gradePoint})</strong> : st.letterGrade ? `${st.letterGrade} (${st.gradePoint})` : '-'}</td>
                  {published && (
                    <td className="row-actions">
                      {can.requestCorrection && !st.pendingCorrection && <button className="link-btn" onClick={() => setFix({ resultId: st.result.id, name: st.fullName, reason: '', marks: Object.fromEntries(data.components.map((c) => [c.id, st.marks[c.id] ?? ''])) })}>Request correction</button>}
                      {st.pendingCorrection && <span className="badge badge-pending_verification">Correction pending</span>}
                      <button className="link-btn" onClick={() => showHistory(st.result.id)}>History</button>
                    </td>
                  )}
                </tr>
              );
            })}</tbody>
          </table></div>
          {can.edit && <p className="hint">Leave a box empty if there is no mark yet. Grades appear after saving. Zero is a real mark.</p>}
        </>
      )}

      <div className="btn-row">
        {can.edit && data.components.length > 0 && <button className="btn btn-solid" onClick={saveMarks} disabled={busy}>{busy ? 'Saving...' : 'Save marks'}</button>}
        {can.submit && <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirm({ title: 'Submit these results?', text: 'Marks are locked and sent for publication. Only the results office can reopen them.', label: 'Submit', run: () => call('submit', 'POST', undefined, 'Results submitted.') })}>Submit for publication</button>}
        {can.reopen && <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirm({ title: 'Reopen these results?', text: 'They return to draft and can be edited again.', label: 'Reopen', run: () => call('reopen', 'POST', undefined, 'Results reopened.') })}>Reopen</button>}
        {can.publish && <button className="btn btn-solid" disabled={busy} onClick={() => setConfirm({ title: 'Publish these results?', text: 'Students can see them immediately and the courses count as passed or failed. Later changes need an approved correction.', label: 'Publish', run: () => call('publish', 'POST', undefined, 'Results published.') })}>Publish</button>}
      </div>

      {fix && (
        <form className="editor" onSubmit={sendCorrection} noValidate>
          <h3>Correction for {fix.name}</h3>
          {data.components.map((c) => (
            <div className="field" key={c.id}><label htmlFor={`fx${c.id}`}>{c.name} (max {c.maxMarks})</label>
              <input id={`fx${c.id}`} inputMode="decimal" value={fix.marks[c.id]} onChange={(e) => setFix({ ...fix, marks: { ...fix.marks, [c.id]: e.target.value } })} /></div>
          ))}
          <div className="field"><label htmlFor="fxr">Reason (at least 10 characters)</label><input id="fxr" value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} /></div>
          <div className="btn-row"><button className="btn btn-solid" disabled={busy}>Send for approval</button><button type="button" className="btn btn-quiet" onClick={() => setFix(null)}>Cancel</button></div>
        </form>
      )}
      {hist && (
        <div className="editor">
          <h3>History</h3>
          <ul>{hist.map((h) => <li key={h.version}>Version {h.version}: {h.letterGrade} ({h.gradePoint}), {h.percentage}%, {h.reason || ''} {h.changedBy ? `by ${h.changedBy}` : ''}</li>)}</ul>
          <button className="btn btn-quiet" onClick={() => setHist(null)}>Close</button>
        </div>
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.text || ''} confirmLabel={confirm?.label} busy={busy} onConfirm={() => confirm.run()} onCancel={() => setConfirm(null)} />
    </section>
  );
}
