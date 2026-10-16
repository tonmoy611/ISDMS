import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../services/api.js';
import Field from '../components/Field.jsx';

// Public page: anyone holding a printed document can confirm it is genuine.
export default function VerifyDocument() {
  const [sp] = useSearchParams();
  const [serial, setSerial] = useState(sp.get('s') || '');
  const [code, setCode] = useState(sp.get('c') || '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = async (e) => {
    e?.preventDefault(); setBusy(true); setError(''); setResult(null);
    const r = await api(`/verify/${encodeURIComponent(serial.trim())}?code=${encodeURIComponent(code.trim())}`);
    setBusy(false);
    if (r.ok) setResult(r.body.data); else setError(errorMessage(r));
  };
  useEffect(() => { if (sp.get('s') && sp.get('c')) check(); }, []); // eslint-disable-line

  return (
    <div className="auth-page">
      <form className="auth-card wide" onSubmit={check} noValidate>
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">I</span>ISDMS</Link>
        <h1>Verify a document</h1>
        <p className="hint">Enter the serial number and the 12-character verification code printed at the bottom of the document.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <Field id="serial" label="Serial number" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="TR-2026-000123" autoComplete="off" required />
        <Field id="code" label="Verification code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} autoComplete="off" required />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking...' : 'Check document'}</button>
        {result && !result.valid && !result.revoked && <div className="alert alert-error" role="status">No genuine document matches these details. Check the serial number and code, or contact the university.</div>}
        {result?.revoked && <div className="alert alert-error" role="status">This document was issued but has since been <strong>revoked</strong>. It is not valid.</div>}
        {result?.valid && (
          <div className="alert alert-ok" role="status">
            <strong>Genuine document.</strong>
            <table className="kv-plain"><tbody>
              <tr><td>Document</td><td>{result.type}{result.official ? '' : ' (student copy)'}</td></tr>
              <tr><td>Issued to</td><td>{result.studentName} ({result.studentId})</td></tr>
              <tr><td>University</td><td>{result.university}</td></tr>
              {result.semester && <tr><td>Semester</td><td>{result.semester}</td></tr>}
              <tr><td>Issued on</td><td>{String(result.issuedAt).slice(0, 10)}</td></tr>
            </tbody></table>
          </div>
        )}
      </form>
    </div>
  );
}
