import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const { state } = useLocation();
  return (
    <section className="panel">
      <h1>Welcome, {user.fullName}</h1>
      {state?.passwordChanged && <div className="alert alert-ok" role="status">Your password was changed.</div>}
      <table className="map-table">
        <caption>Your account</caption>
        <tbody>
          <tr><th scope="row">Login ID</th><td>{user.loginId}</td></tr>
          <tr><th scope="row">Email</th><td>{user.email || 'Not set'}</td></tr>
          <tr><th scope="row">Role</th><td>{user.role.replace('_', ' ')}</td></tr>
          <tr><th scope="row">Status</th><td>{user.status}</td></tr>
        </tbody>
      </table>
      <p className="hint">University management, enrollment and finance appear here as they are added in later phases.</p>
    </section>
  );
}
