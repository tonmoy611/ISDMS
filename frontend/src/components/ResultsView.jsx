import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';

export default function ResultsView({ studentId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(studentId ? `/results/students/${studentId}` : '/results/me').then((r) => (r.ok ? setData(r.body.data) : setError(errorMessage(r)))); }, [studentId]);
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <p className="page-loading" role="status">Loading...</p>;
  return (
    <div>
      {studentId && <p><strong>{data.student.fullName}</strong> ({data.student.studentId})</p>}
      {data.semesters.length === 0 ? <p className="empty">No results have been published yet.</p> : (
        <>
          <div className="stat-row">
            <div className="stat"><span>CGPA</span><strong>{data.cgpa === null ? '-' : data.cgpa.toFixed(2)}</strong></div>
            <div className="stat"><span>Credits earned</span><strong>{data.creditsEarned}</strong></div>
            <div className="stat"><span>Credits attempted</span><strong>{data.creditsAttempted}</strong></div>
          </div>
          <p className="hint">If a course was taken more than once, only the latest attempt counts toward the CGPA.</p>
          {data.semesters.map((s) => (
            <div key={s.semesterId}>
              <h2>{s.name} <small>GPA {s.gpa === null ? '-' : s.gpa.toFixed(2)}</small></h2>
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Course</th><th>Credit</th><th>Marks</th><th>Grade</th><th>Points</th></tr></thead>
                <tbody>{s.courses.map((c) => (
                  <tr key={c.courseId + c.sectionCode}><td>{c.courseCode}: {c.courseTitle}</td><td>{c.credit}</td><td>{c.percentage}%</td><td><strong>{c.letterGrade}</strong>{!c.isPass && ' (fail)'}</td><td>{c.gradePoint.toFixed(2)}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
