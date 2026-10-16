import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import useUniversityScope from '../components/useUniversityScope.jsx';
import ResourceManager from '../components/ResourceManager.jsx';
import Field from '../components/Field.jsx';
import Timetable from './Timetable.jsx';

export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function SectionList({ universityId }) {
  const { can } = useAuth();
  const canManage = can('sections.manage');
  const [semesters, setSemesters] = useState([]);
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [semesterId, setSemesterId] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ loading: true });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = `pageSize=200&universityId=${universityId}`;
    api(`/structure/semesters?${u}`).then((r) => r.ok && setSemesters(r.body.data.items));
    api(`/structure/shifts?${u}`).then((r) => r.ok && setShifts(r.body.data.items));
    if (canManage) {
      api(`/structure/courses?${u}&status=active`).then((r) => r.ok && setCourses(r.body.data.items));
      api(`/sections/teachers?universityId=${universityId}`).then((r) => r.ok && setTeachers(r.body.data.teachers));
    }
  }, [universityId, canManage]);

  const load = useCallback(async () => {
    const qs = `page=${page}&pageSize=20&universityId=${universityId}${semesterId ? `&semesterId=${semesterId}` : ''}${applied ? `&q=${encodeURIComponent(applied)}` : ''}`;
    const r = await api(`/sections?${qs}`);
    setData(r.ok ? { loading: false, ...r.body.data } : { loading: false, error: errorMessage(r) });
  }, [universityId, semesterId, applied, page]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const create = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const r = await api('/sections', { method: 'POST', body: { ...form, universityId } });
    setBusy(false);
    if (r.ok) { setForm(null); setNotice({ ok: true, text: 'Section created. Open it to set the schedule.' }); load(); }
    else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };
  const select = (id, label, opts, extra) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={form[id] ?? ''} onChange={set(id)} aria-invalid={!!errors[id]}>
        <option value="">{extra || 'Choose...'}</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {errors[id] && <p className="field-error">{errors[id]}</p>}
    </div>
  );

  return (
    <section>
      <div className="panel-head">
        <h2 className="flush">Sections</h2>
        {canManage && !form && <button className="btn btn-solid" onClick={() => { setForm({ courseId: '', semesterId, sectionCode: 'A', capacity: '40', teacherId: '', shiftId: '', status: 'open' }); setErrors({}); setNotice(null); }}>Add section</button>}
      </div>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {form && (
        <form className="editor" onSubmit={create} noValidate>
          <h3>New section</h3>
          {select('courseId', 'Course', courses.map((c) => [c.id, `${c.code}: ${c.title}`]))}
          {select('semesterId', 'Semester', semesters.map((s) => [s.id, `${s.name} (${s.academicYearName})`]))}
          <Field id="sectionCode" label="Section code" value={form.sectionCode} onChange={set('sectionCode')} error={errors.sectionCode} hint="For example A or B." />
          <Field id="capacity" label="Seats" type="number" value={form.capacity} onChange={set('capacity')} error={errors.capacity} />
          {select('teacherId', 'Teacher (optional)', teachers.map((t) => [t.id, `${t.fullName} (${t.loginId})`]), 'Not assigned yet')}
          {select('shiftId', 'Shift (optional)', shifts.filter((s) => s.status === 'active').map((s) => [s.id, s.name]), 'None')}
          <div className="btn-row">
            <button className="btn btn-solid" disabled={busy}>{busy ? 'Saving...' : 'Create section'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(q); }}>
        <select aria-label="Semester" value={semesterId} onChange={(e) => { setSemesterId(e.target.value); setPage(1); }}>
          <option value="">All semesters</option>
          {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input aria-label="Search sections" placeholder="Search course code, title or section" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-quiet">Search</button>
      </form>
      {data.error && <div className="alert alert-error" role="alert">{data.error}</div>}
      {data.loading && !data.items && <p className="hint" role="status">Loading...</p>}
      {data.items && data.items.length === 0 && <p className="empty">No sections yet.</p>}
      {data.items && data.items.length > 0 && (
        <>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Course</th><th>Section</th><th>Semester</th><th>Teacher</th><th>Seats</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/sections/${s.id}`}>{s.courseCode}</Link> {s.courseTitle}</td><td>{s.sectionCode}</td><td>{s.semesterName}</td>
                <td>{s.teacherName || '-'}</td><td>{s.capacity}</td><td><span className={`badge badge-${s.status === 'open' ? 'active' : s.status === 'closed' ? 'inactive' : 'blocked'}`}>{s.status}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="pager">
            <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total})</span>
            <button className="btn btn-quiet" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}

export default function Sections({ tab = 'sections' }) {
  const { universityId, picker, search } = useUniversityScope();
  const { can } = useAuth();
  return (
    <section className="panel">
      <h1>Classes and schedule</h1>
      {picker}
      <nav className="tabs" aria-label="Schedule sections">
        <NavLink end to={`/sections${search}`}>Sections</NavLink>
        <NavLink to={`/sections/timetable${search}`}>Timetable</NavLink>
        <NavLink to={`/sections/rooms${search}`}>Rooms</NavLink>
        {can('calendar.view') && <NavLink to={`/sections/calendar${search}`}>Academic calendar</NavLink>}
      </nav>
      {!universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          {tab === 'sections' && <SectionList key={universityId} universityId={universityId} />}
          {tab === 'timetable' && <Timetable key={universityId} universityId={universityId} />}
          {tab === 'rooms' && <ResourceManager key={universityId} resource="rooms" universityId={universityId} />}
          {tab === 'calendar' && <ResourceManager key={universityId} resource="calendar-events" universityId={universityId} />}
        </>
      )}
    </section>
  );
}
