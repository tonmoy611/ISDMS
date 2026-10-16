import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function Timetable({ universityId }) {
  const [semesters, setSemesters] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [semesterId, setSemesterId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const u = `pageSize=200&universityId=${universityId}`;
    api(`/structure/semesters?${u}`).then((r) => r.ok && setSemesters(r.body.data.items));
    api(`/structure/rooms?${u}`).then((r) => r.ok && setRooms(r.body.data.items));
  }, [universityId]);

  useEffect(() => {
    setSlots(null); setError('');
    if (!semesterId) return;
    api(`/sections/timetable?universityId=${universityId}&semesterId=${semesterId}${roomId ? `&roomId=${roomId}` : ''}`)
      .then((r) => (r.ok ? setSlots(r.body.data.slots) : setError(errorMessage(r))));
  }, [universityId, semesterId, roomId]);

  const days = slots ? [...new Set(slots.map((s) => s.dayOfWeek))].sort() : [];
  return (
    <section>
      <div className="filters">
        <select aria-label="Semester" value={semesterId} onChange={(e) => setSemesterId(e.target.value)}>
          <option value="">Choose a semester</option>
          {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">All rooms</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.code}: {r.name}</option>)}
        </select>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {slots && slots.length === 0 && <p className="empty">No classes are scheduled.</p>}
      {days.map((d) => (
        <div key={d}>
          <h3>{DAYS[d]}</h3>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Time</th><th>Course</th><th>Section</th><th>Teacher</th><th>Room</th></tr></thead>
            <tbody>{slots.filter((s) => s.dayOfWeek === d).map((s) => (
              <tr key={s.id}><td>{s.startTime} - {s.endTime}</td><td>{s.courseCode}: {s.courseTitle}</td><td>{s.sectionCode} ({s.slotType})</td><td>{s.teacherName || '-'}</td><td>{s.roomName || '-'}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
    </section>
  );
}
