import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from '../components/Field.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { roleLabel, statusLabel } from './Users.jsx';

const actions = {
  active: [['blocked', 'Block', true], ['inactive', 'Deactivate', true]],
  blocked: [['active', 'Unblock', false]],
  inactive: [['active', 'Activate', false]],
  pending_verification: [['blocked', 'Block', true]],
};

export default function UserDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const { user: me, can, isSuperAdmin } = useAuth();
  const [u, setU] = useState(null);
  const [perm, setPerm] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(state?.created ? { ok: true, text: 'User created.' } : null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tempPw, setTempPw] = useState('');

  const say = (r, okText) => setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: errorMessage(r) });

  const load = useCallback(async () => {
    const r = await api(`/users/${id}`);
    if (!r.ok) { setNotice({ ok: false, text: errorMessage(r) }); return; }
    setU(r.body.data.user);
    setForm({ fullName: r.body.data.user.fullName, email: r.body.data.user.email || '', phone: r.body.data.user.phone || '' });
    if (can('permissions.view')) {
      const [p, c] = await Promise.all([api(`/permissions/users/${id}`), api('/permissions')]);
      if (p.ok && c.ok) {
        setPerm(p.body.data); setCatalog(c.body.data.permissions);
        const o = {};
        p.body.data.overrides.grant.forEach((k) => { o[k] = 'grant'; });
        p.body.data.overrides.deny.forEach((k) => { o[k] = 'deny'; });
        setOverrides(o);
      }
    }
  }, [id, can]);
  useEffect(() => { load(); }, [load]);

  const saveProfile = async (e) => {
    e.preventDefault(); setErrors({}); setBusy(true);
    const r = await api(`/users/${id}`, { method: 'PATCH', body: form });
    setBusy(false); setErrors(fieldErrors(r)); say(r, 'Details saved.');
    if (r.ok) setU(r.body.data.user);
  };
  const changeStatus = async () => {
    setBusy(true);
    const r = await api(`/users/${id}/status`, { method: 'POST', body: { status: confirm.status } });
    setBusy(false); setConfirm(null); say(r, `Account ${confirm.label.toLowerCase()}ed.`.replace('ee', 'e'));
    if (r.ok) { setU(r.body.data.user); load(); }
  };
  const resetPw = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await api(`/users/${id}/reset-password`, { method: 'POST', body: { temporaryPassword: tempPw } });
    setBusy(false); setErrors(fieldErrors(r)); say(r, 'Temporary password set. The user must change it at next sign-in.');
    if (r.ok) setTempPw('');
  };
  const saveOverrides = async () => {
    setBusy(true);
    const grant = Object.keys(overrides).filter((k) => overrides[k] === 'grant');
    const deny = Object.keys(overrides).filter((k) => overrides[k] === 'deny');
    const r = await api(`/permissions/users/${id}`, { method: 'PUT', body: { grant, deny } });
    setBusy(false); say(r, 'Permissions saved.');
    if (r.ok) load();
  };

  if (!u) return notice ? <div className="alert alert-error" role="alert">{notice.text}</div> : <p className="page-loading" role="status">Loading...</p>;
  const isSelf = u.id === me.id;

  return (
    <section className="panel">
      <p><Link to="/users">Back to users</Link></p>
      <h1>{u.fullName}</h1>
      <p><span className={`badge badge-${u.status}`}>{statusLabel[u.status]}</span> {roleLabel[u.role]} · {u.loginId}</p>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}

      {can('users.status') && !isSelf && (
        <div className="btn-row">
          {(actions[u.status] || []).map(([status, label, danger]) => (
            <button key={status} className={danger ? 'btn btn-danger' : 'btn btn-solid'} onClick={() => setConfirm({ status, label, danger })}>{label}</button>
          ))}
        </div>
      )}

      {can('users.update') && (
        <>
          <h2>Details</h2>
          <form className="narrow-panel" onSubmit={saveProfile} noValidate>
            <Field id="fullName" label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={errors.fullName} />
            <Field id="email" label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
            <Field id="phone" label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} />
            <button className="btn btn-solid" disabled={busy}>Save details</button>
          </form>

          <h2>Reset password</h2>
          <form className="narrow-panel" onSubmit={resetPw} noValidate>
            <Field id="tempPw" label="Temporary password" value={tempPw} onChange={(e) => setTempPw(e.target.value)} error={errors.temporaryPassword} hint="Signs the user out everywhere and requires a new password at next sign-in." autoComplete="off" />
            <button className="btn btn-solid" disabled={busy || !tempPw}>Set temporary password</button>
          </form>
        </>
      )}

      {perm && u.role !== 'super_admin' && (
        <>
          <h2>Permissions</h2>
          <p className="hint">Role defaults come from {roleLabel[u.role]}. {isSuperAdmin ? 'Override them for this person below.' : 'Only a Super Admin can change them.'}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Permission</th><th>From role</th><th>Override</th></tr></thead>
              <tbody>
                {catalog.map((p) => (
                  <tr key={p.code}>
                    <td>{p.description}<br /><small>{p.code}</small></td>
                    <td>{perm.rolePermissions.includes(p.code) ? 'Allowed' : 'Not allowed'}</td>
                    <td>
                      <select aria-label={`Override for ${p.code}`} disabled={!isSuperAdmin} value={overrides[p.code] || ''}
                        onChange={(e) => setOverrides({ ...overrides, [p.code]: e.target.value || undefined })}>
                        <option value="">Use role default</option>
                        <option value="grant">Always allow</option>
                        <option value="deny">Always deny</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isSuperAdmin && <p><button className="btn btn-solid" onClick={saveOverrides} disabled={busy}>Save permissions</button></p>}
        </>
      )}

      <ConfirmDialog open={!!confirm} title={confirm ? `${confirm.label} this account?` : ''} danger={confirm?.danger} busy={busy}
        message={confirm?.status === 'active' ? 'The user will be able to sign in again.' : 'The user is signed out immediately and cannot sign in until the account is active again.'}
        confirmLabel={confirm?.label} onConfirm={changeStatus} onCancel={() => setConfirm(null)} />
    </section>
  );
}
