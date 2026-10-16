import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { DAYS } from './Sections.jsx';

export default function SectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { user } = useAuth();
  const canManage = can('sections.manage');
  const [s, setS] = useState(null);
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({});
  const [teachers, setTeachers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [problems, setProblems] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [roster, setRoster] = useState(null);

  const apply = (d) => {
    setS(d.section); setSlots(d.slots.map((x) => ({ ...x, roomId: x.roomId ?? '' })));
    setForm({ sectionCode: d.section.sectionCode, capacity: d.section.capacity, teacherId: d.section.teacherId ?? '', status: d.section.status, notes: d.section.notes ?? '' });
  };
  useEffect(() => {
    api(`/sections/${id}`).then(async (r) => {
      if (!r.ok) { setNotice({ ok: false, text: errorMessage(r) }); return; }
      apply(r.body.data);
      api(`/enrollment/sections/${id}/roster`).then((q) => q.ok && setRoster(q.body.data));
      if (canManage) {
        const u = r.body.data.section.universityId;
        api(`/sections/teachers?universityId=${u}`).then((t) => t.ok && setTeachers(t.body.data.teachers));
        api(`/structure/rooms?pageSize=200&universityId=${u}&status=active`).then((t) => t.ok && setRooms(t.body.data.items));
      }
    });
  }, [id, canManage]);

  const saveDetails = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null); setProblems([]);
    const r = await api(`/sections/${id}`, { method: 'PATCH', body: form });
    setBusy(false);
    if (r.ok) { apply(r.body.data); setNotice({ ok: true, text: 'Section saved.' }); }
    else { setErrors(fieldErrors(r)); setProblems(fieldErrors(r).conflicts || []); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const saveSlots = async () => {
    setBusy(true); setNotice(null); setProblems([]);
    const r = await api(`/sections/${id}/slots`, { method: 'PUT', body: { slots } });
    setBusy(false);
    if (r.ok) { apply(r.body.data); setProblems(r.body.data.warnings || []); setNotice({ ok: true, text: 'Schedule saved.' }); }
    else { const d = fieldErrors(r); setProblems([...(d.slots || []), ...(d.conflicts || [])]); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const remove = async () => {
    setBusy(true);
    const r = await api(`/sections/${id}`, { method: 'DELETE' });
    setBusy(false); setConfirm(false);
    if (r.ok) navigate('/sections', { replace: true }); else setNotice({ ok: false, text: errorMessage(r) });
  };
  const setSlot = (i, patch) => setSlots(slots.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (!s) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  return (
    <section className="panel">
      <p><Link to="/sections">Back to sections</Link></p>
      <h1>{s.courseCode} section {s.sectionCode}</h1>
      <p>{s.courseTitle} · {s.credit} credits · {s.semesterName} · {s.teacherName || 'No teacher assigned'} · {s.capacity} seats</p>
      {(canManage || user.role === 'teacher' || can('attendance.view')) && <p><Link to={`/attendance/sections/${id}`}>Attendance for this section</Link></p>}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {problems.length > 0 && <div className={`alert ${notice?.ok ? 'alert-info' : 'alert-error'}`}><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}

      {roster && (
        <>
          <h2>Enrolled students ({roster.students.length} of {roster.section.capacity})</h2>
          {roster.students.length === 0 ? <p className="hint">Nobody is enrolled yet.</p> : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Student ID</th><th>Name</th></tr></thead>
              <tbody>{roster.students.map((x) => <tr key={x.enrollmentId}><td>{x.studentId}</td><td>{x.fullName}</td></tr>)}</tbody>
            </table></div>
          )}
        </>
      )}

      <h2>Schedule</h2>
      {!canManage && (slots.length ? <ul>{slots.map((x) => <li key={x.id}>{DAYS[x.dayOfWeek]} {x.startTime}-{x.endTime}, {x.roomName || 'room not set'} ({x.slotType})</li>)}</ul> : <p className="hint">No schedule yet.</p>)}
      {canManage && (
        <>
          {slots.length === 0 && <p className="hint">No classes scheduled yet.</p>}
          {slots.map((x, i) => (
            <div className="curr-row" key={i}>
              <select aria-label={`Day for slot ${i + 1}`} value={x.dayOfWeek} onChange={(e) => setSlot(i, { dayOfWeek: Number(e.target.value) })}>
                {DAYS.slice(1).map((d, k) => <option key={d} value={k + 1}>{d}</option>)}
              </select>
              <input type="time" aria-label={`Start time for slot ${i + 1}`} value={x.startTime} onChange={(e) => setSlot(i, { startTime: e.target.value })} />
              <input type="time" aria-label={`End time for slot ${i + 1}`} value={x.endTime} onChange={(e) => setSlot(i, { endTime: e.target.value })} />
              <select aria-label={`Room for slot ${i + 1}`} value={x.roomId} onChange={(e) => setSlot(i, { roomId: e.target.value })}>
                <option value="">No room</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.code}: {r.name} ({r.capacity})</option>)}
              </select>
              <select aria-label={`Type for slot ${i + 1}`} value={x.slotType} onChange={(e) => setSlot(i, { slotType: e.target.value })}>
                <option value="lecture">Lecture</option><option value="lab">Lab</option><option value="tutorial">Tutorial</option>
              </select>
              <button className="link-btn danger" onClick={() => setSlots(slots.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn btn-quiet" onClick={() => setSlots([...slots, { dayOfWeek: 1, startTime: '09:00', endTime: '10:30', roomId: '', slotType: 'lecture' }])}>Add time slot</button>
            <button className="btn btn-solid" onClick={saveSlots} disabled={busy}>{busy ? 'Saving...' : 'Save schedule'}</button>
          </div>

          <h2>Details</h2>
          <form className="narrow-panel" onSubmit={saveDetails} noValidate>
            <Field id="sectionCode" label="Section code" value={form.sectionCode} onChange={set('sectionCode')} error={errors.sectionCode} />
            <Field id="capacity" label="Seats" type="number" value={form.capacity} onChange={set('capacity')} error={errors.capacity} />
            <div className="field">
              <label htmlFor="teacherId">Teacher</label>
              <select id="teacherId" value={form.teacherId} onChange={set('teacherId')}>
                <option value="">Not assigned</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName} ({t.loginId})</option>)}
              </select>
              {errors.teacherId && <p className="field-error">{errors.teacherId}</p>}
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" value={form.status} onChange={set('status')}>
                <option value="open">Open for registration</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option>
              </select>
            </div>
            <Field id="notes" label="Notes" value={form.notes} onChange={set('notes')} error={errors.notes} />
            <button className="btn btn-solid" disabled={busy}>Save details</button>
          </form>
          <h2>Delete section</h2>
          <p className="hint">Only possible while nothing is attached to it. Otherwise set it to cancelled.</p>
          <button className="btn btn-danger" onClick={() => setConfirm(true)}>Delete section</button>
          <ConfirmDialog open={confirm} title="Delete this section?" message="Its schedule is removed as well." confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setConfirm(false)} />
        </>
      )}
    </section>
  );
}
