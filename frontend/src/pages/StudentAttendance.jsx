import { Link, useParams } from 'react-router-dom';
import AttendanceView from '../components/AttendanceView.jsx';

export default function StudentAttendance() {
  const { id } = useParams();
  return <section className="panel"><p><Link to={`/students/${id}`}>Back to student</Link></p><h1>Attendance</h1><AttendanceView studentId={id} /></section>;
}
