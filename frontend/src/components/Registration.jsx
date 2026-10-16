import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const when = (slots) => (slots.length ? slots.map((s) => `${DAY[s.dayOfWeek]} ${s.startTime}-${s.endTime}`).join(', ') : 'Time not set');
const round1 = (n) => Math.round(n * 10) / 10;

// Used by a student for themselves (no studentId) and by staff on a student's behalf (studentId given).
export default function Registration({ studentId }) {
  const { can } = useAuth();
  const base = studentId ? `/enrollment/students/${studentId}` : '/enrollment/me';
  const canAct = studentId ? can('enrollment.manage') : true;
  const [semesterId, setSemesterId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState({});
  const [override, setOverride] = useState(false);
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async (sid) => {
    const r = await api(`${base}/overview${sid ? `?semesterId=${sid}` : ''}`);
    if (r.ok) { setData(r.body.data); setError(''); } else setError(errorMessage(r));
  }, [base]);
  useEffect(() => { load(semesterId); setPicked({}); setProblems([]); setNotice(null); }, [load, semesterId]);

  const act = async (path, body, okText) => {
    setBusy(true); setProblems([]); setNotice(null);
    const r = await api(`${base}/${path}`, { method: 'POST', body: { semesterId: data.semester.id, ...(override ? { override: true } : {}), ...body } });
    setBusy(false); setConfirm(null);
    if (r.ok) { setData(r.body.data); setPicked({}); setHistory(null); setNotice({ ok: true, text: okText }); }
    else { setProblems((r.body?.error?.details?.errors || []).map((e) => e.message)); setNotice({ ok: false, text: errorMessage(r) }); }
  };

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <p className="page-loading" role="status">Loading...</p>;

  const { window: win, registration, enrolled, rule, available } = data;
  const registered = registration?.status === 'confirmed';
  const canRegisterNow = canAct && (override || win.canRegister);
  const canChangeNow = canAct && (override || win.canAddDrop);
  const chosen = available.filter((c) => picked[c.courseId]);
  const chosenCredits = round1(chosen.reduce((a, c) => a + c.credit, 0));
  const pick = (c, sectionId) => setPicked({ ...picked, [c.courseId]: picked[c.courseId] === sectionId ? undefined : sectionId });

  const showHistory = async () => {
    const r = await api(`${base}/history`);
    if (r.ok) setHistory(r.body.data); else setNotice({ ok: false, text: errorMessage(r) });
  };

  return (
    <div>
      {studentId && <p><strong>{data.student.fullName}</strong> ({data.student.studentId})</p>}
      <div className="field narrow-panel">
        <label htmlFor="sem">Semester</label>
        <select id="sem" value={data.semester.id} onChange={(e) => setSemesterId(e.target.value)}>
          {data.semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}
        </select>
      </div>
      <div className={`alert ${win.canRegister || win.canAddDrop ? 'alert-info' : 'alert-error'}`} role="status">{win.message}</div>
      {studentId && can('enrollment.override') && (
        <label className="check-inline"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Act outside the registration dates (recorded in the audit log)</label>
      )}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {problems.length > 0 && <div className="alert alert-error"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}

      <h2>{registered ? 'Your registered courses' : 'Registration'}</h2>
      {rule && <p className="hint">Allowed per semester: {rule.min} to {rule.max} credits.</p>}
      {registered ? (
        <>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Course</th><th>Section</th><th>Credit</th><th>Schedule</th><th>Teacher</th>{canChangeNow && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>{enrolled.map((l) => (
              <tr key={l.id}><td>{l.courseCode}: {l.courseTitle}</td><td>{l.sectionCode}</td><td>{l.credit}</td><td>{when(l.slots)}</td><td>{l.teacherName || '-'}</td>
                {canChangeNow && <td><button className="link-btn danger" onClick={() => setConfirm({ kind: 'drop', line: l })}>Drop</button></td>}</tr>
            ))}</tbody>
          </table></div>
          <p><strong>Total: {data.totalCredits} credits</strong></p>
          {canChangeNow && <button className="btn btn-danger" onClick={() => setConfirm({ kind: 'cancel' })}>Cancel whole registration</button>}
        </>
      ) : <p className="hint">{registration?.status === 'cancelled' ? 'This registration was cancelled.' : 'Not registered yet.'} Choose your sections below.</p>}

      {(registered ? canChangeNow : canRegisterNow) && (
        <>
          <h2>{registered ? 'Add a course' : 'Available courses'}</h2>
          {available.length === 0 && <p className="empty">No more courses are open for you this semester.</p>}
          {available.map((c) => (
            <div className="course-card" key={c.courseId}>
              <h3>{c.code}: {c.title} <small>({c.credit} credits, {c.isMandatory ? 'mandatory' : 'elective'})</small></h3>
              {!c.eligible && <p className="field-error">{c.reasons.join(' ')}</p>}
              {c.sections.map((s) => (
                <div className="section-row" key={s.id}>
                  {registered ? (
                    <button className="btn btn-quiet" disabled={busy || !c.eligible || s.seatsLeft === 0} onClick={() => act('add', { sectionId: s.id }, `${c.code} added.`)}>Add</button>
                  ) : (
                    <input type="checkbox" aria-label={`Select ${c.code} section ${s.sectionCode}`} disabled={!c.eligible || s.seatsLeft === 0} checked={picked[c.courseId] === s.id} onChange={() => pick(c, s.id)} />
                  )}
                  <span>Section {s.sectionCode} · {when(s.slots)} · {s.teacherName || 'Teacher not set'} · {s.seatsLeft === 0 ? 'Full' : `${s.seatsLeft} of ${s.capacity} seats left`}</span>
                </div>
              ))}
            </div>
          ))}
          {!registered && (
            <div className="sticky-bar">
              <span>{chosen.length} course(s), {chosenCredits} credits</span>
              <button className="btn btn-solid" disabled={busy || chosen.length === 0} onClick={() => act('register', { sectionIds: Object.values(picked).filter(Boolean) }, 'Registration confirmed. A confirmation email was sent if an address is on file.')}>{busy ? 'Registering...' : 'Confirm registration'}</button>
            </div>
          )}
        </>
      )}

      <h2>History</h2>
      {!history ? <button className="btn btn-quiet" onClick={showHistory}>Show registration history</button> : history.length === 0 ? <p className="hint">No registrations yet.</p> : history.map((h) => (
        <div key={h.semesterId}>
          <h3>{h.semesterName} <span className={`badge badge-${h.status === 'confirmed' ? 'active' : 'blocked'}`}>{h.status}</span></h3>
          <ul>{h.lines.map((l) => <li key={l.id}>{l.courseCode} section {l.sectionCode}, {l.credit} credits: {l.status}{l.status === 'enrolled' ? `, ${l.outcome.replace('_', ' ')}` : l.dropReason ? ` (${l.dropReason})` : ''}</li>)}</ul>
        </div>
      ))}

      <ConfirmDialog open={!!confirm} busy={busy} danger confirmLabel={confirm?.kind === 'drop' ? 'Drop course' : 'Cancel registration'}
        title={confirm?.kind === 'drop' ? `Drop ${confirm.line.courseCode}?` : 'Cancel the whole registration?'}
        message={confirm?.kind === 'drop' ? 'The seat is released. You may not be able to get it back if the section fills up.' : 'All courses are dropped and your seats are released.'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm.kind === 'drop' ? act('drop', { enrollmentId: confirm.line.id }, 'Course dropped.') : act('cancel', {}, 'Registration cancelled.'))} />
    </div>
  );
}
