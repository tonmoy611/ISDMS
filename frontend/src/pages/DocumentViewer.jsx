import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE, errorMessage, fieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export default function DocumentViewer() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const frame = useRef(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => { api(`/documents/${id}`).then((r) => (r.ok ? setDoc(r.body.data.document) : setError(errorMessage(r)))); }, [id]);

  const revoke = async () => {
    setBusy(true); setFieldError('');
    const r = await api(`/documents/${id}/revoke`, { method: 'POST', body: { reason } });
    setBusy(false); setConfirm(false);
    if (r.ok) { setDoc(r.body.data.document); setFrameKey((k) => k + 1); } else { setFieldError(fieldErrors(r).reason || errorMessage(r)); }
  };

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!doc) return <p className="page-loading" role="status">Loading...</p>;
  const url = `${API_BASE}/documents/${id}/print`;
  const back = user.role === 'student' ? '/my-documents' : can('documents.view') ? '/documents' : '/dashboard';
  return (
    <section className="panel">
      <p><Link to={back}>Back to documents</Link></p>
      <h1>{doc.title}</h1>
      <p>{doc.serial} · {doc.studentName} ({doc.studentCode}) {doc.revoked && <span className="badge badge-blocked">Revoked</span>}</p>
      <div className="btn-row">
        <button className="btn btn-solid" onClick={() => frame.current?.contentWindow?.print()}>Print</button>
        <a className="btn btn-quiet" href={`${url}?download=1`}>Download</a>
      </div>
      <p className="hint">Printing from here gives a clean A4 page. Choose "Save as PDF" in the print window to keep a PDF copy.</p>
      <iframe key={frameKey} ref={frame} className="doc-frame" title={`${doc.title} ${doc.serial}`} src={url} />
      {can('documents.manage') && !doc.revoked && (
        <>
          <h2>Revoke this document</h2>
          <p className="hint">A revoked document is marked invalid on its printout and in public verification.</p>
          <div className="field narrow-panel"><label htmlFor="rr">Reason (at least 10 characters)</label><input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} />{fieldError && <p className="field-error">{fieldError}</p>}</div>
          <button className="btn btn-danger" onClick={() => setConfirm(true)} disabled={reason.trim().length < 10}>Revoke</button>
          <ConfirmDialog open={confirm} title="Revoke this document?" message="This cannot be undone." confirmLabel="Revoke" danger busy={busy} onConfirm={revoke} onCancel={() => setConfirm(false)} />
        </>
      )}
    </section>
  );
}
