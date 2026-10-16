import Field from './Field.jsx';

export const PROFILE_FIELDS = [
  ['admissionDate', 'Admission date', 'date'],
  ['dateOfBirth', 'Date of birth', 'date'],
  ['gender', 'Gender', 'select', [['male', 'Male'], ['female', 'Female'], ['other', 'Other']]],
  ['bloodGroup', 'Blood group', 'select', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => [b, b])],
  ['nationalId', 'National ID or birth registration no.', 'text'],
  ['fatherName', "Father's name", 'text'],
  ['motherName', "Mother's name", 'text'],
  ['guardianPhone', 'Guardian phone', 'text'],
  ['presentAddress', 'Present address', 'text'],
  ['permanentAddress', 'Permanent address', 'text'],
  ['emergencyContactName', 'Emergency contact name', 'text'],
  ['emergencyContactPhone', 'Emergency contact phone', 'text'],
];

/** Renders profile inputs. `only` limits which keys are shown (a student edits just contact fields). */
export default function ProfileFields({ values, onChange, errors = {}, only }) {
  return PROFILE_FIELDS.filter(([k]) => !only || only.includes(k)).map(([key, text, type, options]) => {
    const id = `pf-${key}`;
    if (type === 'select') {
      return (
        <div className="field" key={key}>
          <label htmlFor={id}>{text}</label>
          <select id={id} value={values[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })}>
            <option value="">Not set</option>
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {errors[key] && <p className="field-error">{errors[key]}</p>}
        </div>
      );
    }
    return <Field key={key} id={id} label={text} type={type} value={values[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} error={errors[key]} autoComplete="off" />;
  });
}
