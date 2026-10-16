import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function CourseDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [all, setAll] = useState([]);
  const [chosen, setChosen] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('courses.manage');

  const apply = useCallback((data) => { setD(data); setChosen(new Set(data.prerequisites.map((p) => p.id))); }, []);
  useEffect(() => {
    api(`/courses/${id}`).then(async (r) => {
      if (!r.ok) { setNotice({ ok: false, text: errorMessage(r) }); return; }
      apply(r.body.data);
      if (canManage) {
        const list = await api(`/structure/courses?pageSize=200&universityId=${r.body.data.course.universityId}`);
        if (list.ok) setAll(list.body.data.items);
      }
    });
  }, [id, canManage, apply]);

  const toggle = (cid) => setChosen((s) => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });
  const save = async () => {
    setBusy(true); setNotice(null);
    const r = await api(`/courses/${id}/prerequisites`, { method: 'PUT', body: { prerequisiteIds: [...chosen] } });
    setBusy(false);
    if (r.ok) { apply(r.body.data); setNotice({ ok: true, text: 'Prerequisites saved.' }); } else setNotice({ ok: false, text: errorMessage(r) });
  };

  if (!d) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const c = d.course;
  const candidates = all.filter((x) => x.id !== c.id && (chosen.has(x.id) || x.status === 'active') && `${x.code} ${x.title}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section className="panel">
      <p><Link to="/courses">Back to courses</Link></p>
      <h1>{c.code}: {c.title}</h1>
      <p><span className={`badge badge-${c.status}`}>{c.status}</span> {c.credit} credits · {c.courseType.replace('_', ' ')} · {c.departmentName}</p>
      {c.description && <p>{c.description}</p>}
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}

      <h2>Prerequisites</h2>
      {!canManage && (d.prerequisites.length ? <ul>{d.prerequisites.map((p) => <li key={p.id}>{p.code}: {p.title}</li>)}</ul> : <p className="hint">None.</p>)}
      {canManage && (
        <>
          <p className="hint">A student must have completed every course ticked here before registering for this one.</p>
          <input className="filter-input" aria-label="Filter courses" placeholder="Filter courses" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="checklist" role="group" aria-label="Prerequisites">
            {candidates.length === 0 && <p className="hint">No other courses match.</p>}
            {candidates.map((x) => (
              <label key={x.id}><input type="checkbox" checked={chosen.has(x.id)} onChange={() => toggle(x.id)} /> {x.code}: {x.title}</label>
            ))}
          </div>
          <p><button className="btn btn-solid" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save prerequisites'}</button></p>
        </>
      )}

      <h2>Required by</h2>
      {d.requiredBy.length ? <ul>{d.requiredBy.map((p) => <li key={p.id}><Link to={`/courses/${p.id}`}>{p.code}: {p.title}</Link></li>)}</ul> : <p className="hint">No other course requires this one.</p>}

      <h2>Offered in programs</h2>
      {d.programs.length ? (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Program</th><th>Semester</th><th>Type</th></tr></thead>
          <tbody>{d.programs.map((p) => <tr key={p.programId}><td>{p.programName}</td><td>{p.semesterNo}</td><td>{p.isMandatory ? 'Mandatory' : 'Elective'}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="hint">Not part of any program curriculum yet.</p>}
    </section>
  );
}
