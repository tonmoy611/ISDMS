import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';
import { RESOURCES } from '../services/structureConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import Field from './Field.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

const show = (key, v) => (v == null || v === '' ? '-' : /Time$/.test(key) ? String(v).slice(0, 5) : String(v));
const blank = (cfg) => Object.fromEntries(cfg.fields.map((f) => [f.key, f.default ?? '']));

export default function ResourceManager({ resource, universityId }) {
  const cfg = RESOURCES[resource];
  const isUni = resource === 'universities';
  const { can, isSuperAdmin, isPlatform } = useAuth();
  const base = cfg.base || `/structure/${resource}`;
  const manage = cfg.manage || 'structure.manage';
  const canCreate = isUni ? isPlatform : can(manage);
  const canEdit = isUni ? isSuperAdmin : can(manage);
  const itemKey = cfg.itemKey || 'item';
  const scope = !isUni && universityId ? `&universityId=${universityId}` : '';

  const [data, setData] = useState({ loading: true });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [editor, setEditor] = useState(null); // { id?: number }
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [options, setOptions] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api(`${base}?page=${page}&pageSize=20${scope}${applied ? `&q=${encodeURIComponent(applied)}` : ''}`);
    setData(r.ok ? { loading: false, ...r.body.data } : { loading: false, error: errorMessage(r) });
  }, [base, page, scope, applied]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    cfg.fields.filter((f) => f.type === 'parent').forEach(async (f) => {
      const r = await api(`/structure/${f.parent}?pageSize=200${scope}`);
      if (r.ok) setOptions((o) => ({ ...o, [f.key]: r.body.data.items.map((i) => [i.id, i.code ? `${i.code} - ${i.name}` : i.name]) }));
    });
  }, [cfg, scope]);

  const openNew = () => { setEditor({}); setValues(blank(cfg)); setErrors({}); setNotice(null); };
  const openEdit = (row) => {
    setEditor({ id: row.id }); setErrors({}); setNotice(null);
    setValues(Object.fromEntries(cfg.fields.map((f) => [f.key, f.type === 'time' ? String(row[f.key] ?? '').slice(0, 5) : row[f.key] ?? ''])));
  };

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setNotice(null);
    const editing = editor.id != null;
    const body = { ...values };
    if (editing) cfg.fields.filter((f) => f.createOnly).forEach((f) => delete body[f.key]);
    else if (!isUni && universityId) body.universityId = universityId;
    const r = await api(editing ? `${base}/${editor.id}` : base, { method: editing ? 'PATCH' : 'POST', body });
    setBusy(false);
    if (r.ok) { setEditor(null); setNotice({ ok: true, text: `${cfg.single[0].toUpperCase()}${cfg.single.slice(1)} saved.` }); load(); }
    else { setErrors(fieldErrors(r)); setNotice({ ok: false, text: errorMessage(r) }); }
  };

  const act = async (path, method, okText) => {
    setBusy(true);
    const r = await api(path, { method, body: method === 'POST' ? confirm?.body : undefined });
    setBusy(false); setConfirm(null);
    setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: errorMessage(r) });
    if (r.ok) load();
  };

  const set = (k) => (e) => setValues({ ...values, [k]: e.target.value });
  const fieldsShown = cfg.fields.filter((f) => !(editor?.id != null && f.type === 'parent' && false));

  return (
    <section>
      <div className="panel-head">
        <h2 className="flush">{cfg.title}</h2>
        {canCreate && !editor && <button className="btn btn-solid" onClick={openNew}>Add {cfg.single}</button>}
      </div>
      {notice && <div className={`alert ${notice.ok ? 'alert-ok' : 'alert-error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}

      {editor && (
        <form className="editor" onSubmit={save} noValidate>
          <h3>{editor.id != null ? `Edit ${cfg.single}` : `New ${cfg.single}`}</h3>
          {fieldsShown.map((f) => {
            const id = `f-${f.key}`;
            const disabled = editor.id != null && f.createOnly;
            if (f.type === 'select' || f.type === 'parent') {
              const opts = f.type === 'select' ? f.options : options[f.key] || [];
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={id}>{f.label}</label>
                  <select id={id} value={values[f.key] ?? ''} onChange={set(f.key)} disabled={disabled} aria-invalid={!!errors[f.key]}>
                    {f.type === 'parent' && <option value="">{f.optional ? 'None' : 'Choose...'}</option>}
                    {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {errors[f.key] && <p className="field-error">{errors[f.key]}</p>}
                </div>
              );
            }
            return <Field key={f.key} id={id} label={f.label} type={f.type || 'text'} hint={f.hint} step={f.step} value={values[f.key] ?? ''} onChange={set(f.key)} error={errors[f.key]} disabled={disabled} autoComplete="off" />;
          })}
          <div className="btn-row">
            <button className="btn btn-solid" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditor(null)}>Cancel</button>
          </div>
        </form>
      )}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(q); }}>
        <input aria-label={`Search ${cfg.title.toLowerCase()}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-quiet">Search</button>
      </form>

      {data.error && <div className="alert alert-error" role="alert">{data.error}</div>}
      {data.loading && !data.items && <p className="hint" role="status">Loading...</p>}
      {data.items && data.items.length === 0 && <p className="empty">Nothing here yet.{canCreate ? ` Add the first ${cfg.single}.` : ''}</p>}
      {data.items && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{cfg.columns.map(([k, h]) => <th key={k}>{h}</th>)}{cfg.current && <th>Current</th>}{(canEdit || cfg.detail) && <th><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    {cfg.columns.map(([k]) => (
                      <td key={k}>{k === 'status' ? <span className={`badge badge-${row.status}`}>{row.status}</span> : show(k, row[k])}</td>
                    ))}
                    {cfg.current && <td>{row.isCurrent ? <span className="badge badge-active">Current</span> : '-'}</td>}
                    {(canEdit || cfg.detail) && (
                      <td className="row-actions">
                        {cfg.detail && <Link className="link-btn" to={cfg.detail(row)}>Details</Link>}
                        {canEdit && <button className="link-btn" onClick={() => openEdit(row)}>Edit</button>}
                        {canEdit && <>
                        {cfg.current && !row.isCurrent && <button className="link-btn" onClick={() => setConfirm({ title: `Make ${row.name} current?`, text: 'It replaces the current one for this university.', label: 'Make current', run: () => act(`${base}/${row.id}/set-current`, 'POST', 'Current updated.') })}>Make current</button>}
                        {isUni && isPlatform && <button className="link-btn" onClick={() => setConfirm({ title: `${row.status === 'active' ? 'Deactivate' : 'Activate'} ${row.name}?`, text: row.status === 'active' ? 'Nobody from this university can sign in until it is activated again.' : 'Its users can sign in again.', label: row.status === 'active' ? 'Deactivate' : 'Activate', danger: row.status === 'active', body: { status: row.status === 'active' ? 'inactive' : 'active' }, run: (b) => act(`${base}/${row.id}/status`, 'POST', 'Status updated.', b) })}>{row.status === 'active' ? 'Deactivate' : 'Activate'}</button>}
                        {!isUni && <button className="link-btn danger" onClick={() => setConfirm({ title: `Delete ${row.name || row.title || row.code}?`, text: 'This cannot be undone. If it is in use, set it to inactive instead.', label: 'Delete', danger: true, run: () => act(`${base}/${row.id}`, 'DELETE', 'Deleted.') })}>Delete</button>}
                        </>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total})</span>
            <button className="btn btn-quiet" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.text || ''} confirmLabel={confirm?.label} danger={confirm?.danger} busy={busy}
        onConfirm={() => confirm.run(confirm.body)} onCancel={() => setConfirm(null)} />
    </section>
  );
}
