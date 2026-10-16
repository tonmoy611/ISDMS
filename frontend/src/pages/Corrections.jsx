import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';

export default function Corrections({ universityId }) {
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    const r = await api(`/results/corrections?status=${status}&universityId=${universityId}`);
    if (r.ok) setItems(r.body.data.items); else setNotice({ ok: false, text: errorMessage(r) });
  }, [status, universityId]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, verb) => {
    setBusy(id); setNotice(null);
    const r = await api(`/results/corrections/${id}/${verb}`, { method: 'POST', body: { note: notes[id] } });
    setBusy(0);
    setNotice(r.ok ? { ok: true, text: verb === 'approve' ? 'Correction approved and the result was updated.' : 'Correction rejected.' } : { ok: false, text: errorMessage(r) });
    if (r.ok) load();
  };

  return (
    <section>
      <div className="filters">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Waiting for review</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select>
      </div>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {items && items.length === 0 && <p className="empty">Nothing here.</p>}
      {items && items.map((c) => (
        <div className="course-card" key={c.id}>
          <h3>{c.student.fullName} ({c.student.code}) <small>{c.course}</small></h3>
          <p>Requested by {c.requestedBy}: {c.reason}</p>
          <ul>{c.changes.map((ch) => <li key={ch.componentId}>{ch.componentName}: {ch.oldMarks ?? 'no mark'} to {ch.newMarks}</li>)}</ul>
          <p>Grade now: <strong>{c.current.letterGrade}</strong> ({c.current.percentage}%){c.proposed && <> · after the correction: <strong>{c.proposed.letterGrade}</strong> ({c.proposed.percentage}%)</>}</p>
          {c.status === 'pending' ? (
            <>
              <div className="field"><label htmlFor={`n${c.id}`}>Note (optional)</label><input id={`n${c.id}`} value={notes[c.id] || ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} /></div>
              <div className="btn-row">
                <button className="btn btn-solid" disabled={busy === c.id} onClick={() => decide(c.id, 'approve')}>Approve</button>
                <button className="btn btn-danger" disabled={busy === c.id} onClick={() => decide(c.id, 'reject')}>Reject</button>
              </div>
              <p className="hint">The person who requested a correction cannot review it.</p>
            </>
          ) : <p className="hint">{c.status}{c.reviewNote ? `: ${c.reviewNote}` : ''}</p>}
        </div>
      ))}
    </section>
  );
}
