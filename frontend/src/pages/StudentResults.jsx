import { Link, useParams } from 'react-router-dom';
import ResultsView from '../components/ResultsView.jsx';

export default function StudentResults() {
  const { id } = useParams();
  return <section className="panel"><p><Link to={`/students/${id}`}>Back to student</Link></p><h1>Results</h1><ResultsView studentId={id} /></section>;
}
