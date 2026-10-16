import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Roles() {
  const { isSuperAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/permissions').then((r) => {
      if (!r.ok) { setNotice({ ok: false, text: errorMessage(r) }); return; }
      setData(r.body.data);
      setDraft(Object.fromEntries(r.body.data.roles.map((x) => [x.code, new Set(x.permissions)])));
    });
  }, []);

  const toggle = (role, code) => {
    const next = new Set(draft[role]);
    if (next.has(code)) next.delete(code); else next.add(code);
    setDraft({ ...draft, [role]: next });
  };
  const save = async (role) => {
    setBusy(role);
    const r = await api(`/permissions/roles/${role}`, { method: 'PUT', body: { permissions: [...draft[role]] } });
    setBusy('');
    setNotice(r.ok ? { ok: true, text: 'Role permissions saved.' } : { ok: false, text: errorMessage(r) });
  };

  if (!data) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const roles = data.roles.filter((r) => r.code !== 'super_admin');

  return (
    <section className="panel">
      <h1>Roles and permissions</h1>
      <p className="hint">Super Admin always has full access. {isSuperAdmin ? 'Tick what each role may do by default.' : 'Only a Super Admin can change these.'}</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.code}>{r.name}</th>)}</tr></thead>
          <tbody>
            {data.permissions.map((p) => (
              <tr key={p.code}>
                <td>{p.description}<br /><small>{p.code}</small></td>
                {roles.map((r) => (
                  <td key={r.code}>
                    <input type="checkbox" aria-label={`${r.name}: ${p.description}`} disabled={!isSuperAdmin}
                      checked={draft[r.code]?.has(p.code) || false} onChange={() => toggle(r.code, p.code)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {isSuperAdmin && (
            <tfoot><tr><td />{roles.map((r) => (
              <td key={r.code}><button className="btn btn-solid" onClick={() => save(r.code)} disabled={busy === r.code}>Save</button></td>
            ))}</tr></tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
