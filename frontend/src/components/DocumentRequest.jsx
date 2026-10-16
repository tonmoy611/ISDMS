import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../services/api.js';

const TYPES = [
  ['transcript', 'Transcript (all published results)', false],
  ['semester_result', 'Semester result', true],
  ['admit_card', 'Admit card', true],
  ['enrollment_confirmation', 'Enrollment confirmation', true],
];

// Shared by a student (own documents) and staff (documents for a student). `base` is the API prefix.
export default function DocumentRequest({ base, semesters, allowOverride, studentNote }) {
  const navigate = useNavigate();
  const [type, setType] = useState('enrollment_confirmation');
  const [semesterId, setSemesterId] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState([]);
  const [fields, setFields] = useState({});
  const needsSemester = TYPES.find((t) => t[0] === type)[2];

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setReasons([]); setFields({});
    const body = { type, ...(needsSemester && semesterId ? { semesterId } : {}), ...(override ? { override: true, reason } : {}) };
    const r = await api(`${base}/generate`, { method: 'POST', body });
    setBusy(false);
    if (r.ok) navigate(`/documents/${r.body.data.document.id}`);
    else { setError(errorMessage(r)); setReasons(r.body?.error?.details?.reasons || []); setFields(fieldErrors(r)); }
  };

  return (
    <form className="editor" onSubmit={submit} noValidate>
      <h3>Get a document</h3>
      {studentNote && <p className="hint">{studentNote}</p>}
      {error && <div className="alert alert-error" role="alert">{error}{reasons.length > 0 && <ul>{reasons.map((x) => <li key={x}>{x}</li>)}</ul>}</div>}
      <div className="field">
        <label htmlFor="dtype">Document</label>
        <select id="dtype" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {needsSemester && (
        <div className="field">
          <label htmlFor="dsem">Semester</label>
          <select id="dsem" value={semesterId} onChange={(e) => setSemesterId(e.target.value)}>
            <option value="">Current semester</option>
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{type === 'semester_result' && s.hasResults === false ? ' (no published results)' : ''}</option>)}
          </select>
        </div>
      )}
      {allowOverride && type === 'admit_card' && (
        <>
          <label className="check-inline"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Issue even if the checks fail (recorded in the audit log)</label>
          {override && <div className="field"><label htmlFor="dreason">Reason for the approval</label><input id="dreason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!fields.reason} />{fields.reason && <p className="field-error">{fields.reason}</p>}</div>}
        </>
      )}
      <button className="btn btn-solid" disabled={busy}>{busy ? 'Preparing...' : 'Get document'}</button>
    </form>
  );
}
