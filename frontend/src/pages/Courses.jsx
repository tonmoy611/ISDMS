import { NavLink } from 'react-router-dom';
import useUniversityScope from '../components/useUniversityScope.jsx';
import ResourceManager from '../components/ResourceManager.jsx';
import Curriculum from './Curriculum.jsx';
import CreditRules from './CreditRules.jsx';

export default function Courses({ tab = 'courses' }) {
  const { universityId, picker, search } = useUniversityScope();
  return (
    <section className="panel">
      <h1>Courses</h1>
      {picker}
      <nav className="tabs" aria-label="Course sections">
        <NavLink end to={`/courses${search}`}>Courses</NavLink>
        <NavLink to={`/courses/curriculum${search}`}>Curriculum</NavLink>
        <NavLink to={`/courses/credit-rules${search}`}>Credit rules</NavLink>
      </nav>
      {!universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          {tab === 'courses' && <ResourceManager key={universityId} resource="courses" universityId={universityId} />}
          {tab === 'curriculum' && <Curriculum key={universityId} universityId={universityId} />}
          {tab === 'rules' && <CreditRules key={universityId} universityId={universityId} />}
        </>
      )}
    </section>
  );
}
