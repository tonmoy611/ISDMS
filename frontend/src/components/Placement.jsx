import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

const label = (i) => (i.code ? `${i.code} - ${i.name}` : i.name);

// Department > program > batch, and academic year > semester, plus shift. Children reload when their parent changes.
export default function Placement({ values, onChange, errors = {}, universityId }) {
  const [opts, setOpts] = useState({});
  const scope = universityId ? `&universityId=${universityId}` : '';
  const load = (key, resource, filter) => api(`/structure/${resource}?pageSize=200${scope}${filter || ''}`)
    .then((r) => setOpts((o) => ({ ...o, [key]: r.ok ? r.body.data.items.filter((i) => i.status !== 'inactive') : [] })));

  useEffect(() => { load('departmentId', 'departments'); load('academicYearId', 'academic-years'); load('shiftId', 'shifts'); }, [universityId]); // eslint-disable-line
  useEffect(() => { if (values.departmentId) load('programId', 'programs', `&departmentId=${values.departmentId}`); else setOpts((o) => ({ ...o, programId: [] })); }, [values.departmentId, universityId]); // eslint-disable-line
  useEffect(() => { if (values.programId) load('batchId', 'batches', `&programId=${values.programId}`); else setOpts((o) => ({ ...o, batchId: [] })); }, [values.programId, universityId]); // eslint-disable-line
  useEffect(() => { if (values.academicYearId) load('semesterId', 'semesters', `&academicYearId=${values.academicYearId}`); else setOpts((o) => ({ ...o, semesterId: [] })); }, [values.academicYearId, universityId]); // eslint-disable-line

  const rows = [
    ['departmentId', 'Department', ['programId', 'batchId']],
    ['programId', 'Program', ['batchId']],
    ['batchId', 'Batch', []],
    ['academicYearId', 'Academic year', ['semesterId']],
    ['semesterId', 'Semester', []],
    ['shiftId', 'Shift', []],
  ];
  return rows.map(([key, text, clears]) => (
    <div className="field" key={key}>
      <label htmlFor={`pl-${key}`}>{text}</label>
      <select id={`pl-${key}`} value={values[key] ?? ''} aria-invalid={!!errors[key]}
        onChange={(e) => onChange({ [key]: e.target.value, ...Object.fromEntries(clears.map((c) => [c, ''])) })}>
        <option value="">Choose...</option>
        {(opts[key] || []).map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
      </select>
      {errors[key] && <p className="field-error">{errors[key]}</p>}
    </div>
  ));
}
