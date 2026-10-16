import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import { CurriculumTable } from './Curriculum.jsx';

export default function MyCourses() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/courses/my').then((r) => (r.ok ? setData(r.body.data) : setError(errorMessage(r)))); }, []);
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data) return <p className="page-loading" role="status">Loading...</p>;
  return (
    <section className="panel">
      <h1>My courses</h1>
      <p>{data.program.name}: {data.totalCredits} credits in total.{data.rule && ` You may register ${data.rule.min} to ${data.rule.max} credits each semester.`}</p>
      <CurriculumTable items={data.items} />
    </section>
  );
}
