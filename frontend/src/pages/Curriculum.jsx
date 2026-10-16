import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export function CurriculumTable({ items }) {
  const groups = [...new Set(items.map((i) => i.semesterNo))].sort((a, b) => a - b);
  if (!items.length) return <p className="empty">No courses in this curriculum yet.</p>;
  return groups.map((n) => (
    <div key={n}>
      <h3>Semester {n}</h3>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Code</th><th>Title</th><th>Credit</th><th>Type</th><th>Prerequisites</th></tr></thead>
        <tbody>{items.filter((i) => i.semesterNo === n).map((i) => (
          <tr key={i.courseId}><td>{i.code}</td><td>{i.title}</td><td>{i.credit}</td><td>{i.isMandatory ? 'Mandatory' : 'Elective'}</td><td>{i.prerequisites.map((p) => p.code).join(', ') || '-'}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  ));
}

export default function Curriculum({ universityId }) {
  const { can } = useAuth();
  const canManage = can('courses.manage');
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [programId, setProgramId] = useState('');
  const [data, setData] = useState(null);
  const [rows, setRows] = useState(null); // non-null while editing
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/structure/programs?pageSize=200&universityId=${universityId}`).then((r) => r.ok && setPrograms(r.body.data.items));
    api(`/structure/courses?pageSize=200&universityId=${universityId}`).then((r) => r.ok && setCourses(r.body.data.items));
  }, [universityId]);

  const load = async (id) => {
    setRows(null); setNotice(null); setData(null);
    if (!id) return;
    const r = await api(`/courses/curriculum/${id}`);
    if (r.ok) setData(r.body.data); else setNotice({ ok: false, text: errorMessage(r) });
  };
  const choose = (e) => { setProgramId(e.target.value); load(e.target.value); };

  const startEdit = () => setRows(data.items.map((i) => ({ courseId: String(i.courseId), semesterNo: String(i.semesterNo), isMandatory: i.isMandatory })));
  const setRow = (idx, patch) => setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true); setNotice(null);
    const r = await api(`/courses/curriculum/${programId}`, { method: 'PUT', body: { items: rows } });
    setBusy(false);
    if (r.ok) { setData(r.body.data); setRows(null); setNotice({ ok: true, text: 'Curriculum saved.' }); }
    else setNotice({ ok: false, text: [errorMessage(r), ...(r.body?.error?.details?.items || [])].join(' ') });
  };

  const duration = data?.program.durationSemesters || 1;
  return (
    <section>
      <div className="field narrow-panel">
        <label htmlFor="program">Program</label>
        <select id="program" value={programId} onChange={choose}>
          <option value="">Choose a program</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
        </select>
      </div>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      {data && (
        <>
          <p>Total {data.totalCredits} credits across {data.items.length} courses.{data.rule && ` Allowed per semester: ${data.rule.min} to ${data.rule.max} credits.`}</p>
          {data.warnings.length > 0 && <div className="alert alert-info" role="status"><strong>Check this curriculum:</strong><ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          {!rows && <CurriculumTable items={data.items} />}
          {!rows && canManage && <p><button className="btn btn-solid" onClick={startEdit}>Edit curriculum</button></p>}
          {rows && (
            <div>
              {rows.map((r, i) => (
                <div className="curr-row" key={i}>
                  <select aria-label={`Course ${i + 1}`} value={r.courseId} onChange={(e) => setRow(i, { courseId: e.target.value })}>
                    <option value="">Choose a course</option>
                    {courses.filter((c) => c.status === 'active' || String(c.id) === r.courseId).map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title} ({c.credit})</option>)}
                  </select>
                  <select aria-label={`Semester for course ${i + 1}`} value={r.semesterNo} onChange={(e) => setRow(i, { semesterNo: e.target.value })}>
                    {Array.from({ length: duration }, (_, k) => k + 1).map((n) => <option key={n} value={n}>Semester {n}</option>)}
                  </select>
                  <label><input type="checkbox" checked={r.isMandatory} onChange={(e) => setRow(i, { isMandatory: e.target.checked })} /> Mandatory</label>
                  <button className="link-btn danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</button>
                </div>
              ))}
              <div className="btn-row">
                <button className="btn btn-quiet" onClick={() => setRows([...rows, { courseId: '', semesterNo: '1', isMandatory: true }])}>Add course</button>
                <button className="btn btn-solid" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save curriculum'}</button>
                <button className="btn btn-quiet" onClick={() => setRows(null)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
