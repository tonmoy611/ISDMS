import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';

export default function AttendanceView({ studentId }) {
  const base = studentId ? `/attendance/students/${studentId}` : '/attendance/me';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [days, setDays] = useState([]);

  useEffect(() => { api(base).then((r) => (r.ok ? setData(r.body.data) : setError(errorMessage(r)))); }, [base]);
  const show = async (sectionId) => {
    if (open === sectionId) { setOpen(null); return; }
    const r = await api(`${base}/sections/${sectionId}`);
    if (r.ok) { setDays(r.body.data.days); setOpen(sectionId); } else setError(errorMessage(r));
  };

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <p className="page-loading" role="status">Loading...</p>;
  return (
    <div>
      {studentId && <p><strong>{data.student.fullName}</strong> ({data.student.studentId})</p>}
      <p className="hint">{data.semester.name}. Late counts as attended and excused classes are not counted. Minimum required: {data.minPercent}%.</p>
      {data.courses.length === 0 && <p className="empty">No registered courses this semester.</p>}
      {data.courses.map((c) => (
        <div className="course-card" key={c.sectionId}>
          <h3>{c.courseCode}: {c.courseTitle} <small>section {c.sectionCode}</small></h3>
          {c.percentage === null ? <p className="hint">No classes recorded yet.</p> : (
            <>
              <div className="meter" role="img" aria-label={`${c.percentage} percent attendance`}><span style={{ width: `${c.percentage}%` }} className={c.below ? 'meter-low' : ''} /></div>
              <p><strong>{c.percentage}%</strong> ({c.attended} of {c.counted} classes) {c.below && <span className="badge badge-blocked">Below minimum</span>}</p>
            </>
          )}
          <p className="hint">Present {c.present} · Late {c.late} · Absent {c.absent} · Excused {c.excused}</p>
          <button className="link-btn" onClick={() => show(c.sectionId)}>{open === c.sectionId ? 'Hide days' : 'Show day by day'}</button>
          {open === c.sectionId && (
            <ul>{days.map((d) => <li key={`${d.date}-${d.classNo}`}>{d.date}{d.classNo > 1 ? ` (class ${d.classNo})` : ''}: {d.status || 'not marked'}{d.topic ? ` · ${d.topic}` : ''}</li>)}</ul>
          )}
        </div>
      ))}
    </div>
  );
}
