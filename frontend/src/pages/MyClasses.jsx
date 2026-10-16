import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MyClasses() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/sections/teaching').then((r) => (r.ok ? setItems(r.body.data.sections) : setError(errorMessage(r)))); }, []);
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!items) return <p className="page-loading" role="status">Loading...</p>;
  return (
    <section className="panel">
      <h1>My classes</h1>
      {items.length === 0 ? <p className="empty">No sections are assigned to you yet.</p> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Course</th><th>Section</th><th>Semester</th><th>Schedule</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{items.map(({ section: s, slots }) => (
            <tr key={s.id}>
              <td>{s.courseCode}: {s.courseTitle}</td><td>{s.sectionCode}</td><td>{s.semesterName}</td>
              <td>{slots.length ? slots.map((x) => `${DAY[x.dayOfWeek]} ${x.startTime}-${x.endTime}`).join(', ') : '-'}</td>
              <td><Link to={`/attendance/sections/${s.id}`}>Attendance</Link> · <Link to={`/results/sections/${s.id}`}>Results</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
