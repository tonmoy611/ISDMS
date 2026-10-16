import SystemStatus from '../components/SystemStatus.jsx';

const features = [
  ['Student management', 'Administrators create every student account. Profiles hold personal, academic, admission and financial records in one place.'],
  ['Academic management', 'Faculties, departments, programs, batches, semesters and courses, with credit rules and prerequisites enforced automatically.'],
  ['Enrollment', 'Course selection, add and drop, seat limits and deadlines, checked against credit limits before anything is confirmed.'],
  ['Finance', 'Per-credit tuition, lab and exam fees, waivers, late fees and installments, all configurable by the university.'],
  ['Payment', 'SSLCommerz, bKash and Nagad. The server verifies every transaction; the browser is never trusted.'],
  ['Administration', 'Role-based permissions, audit trail, notices, reports and backups under one control center.'],
];

const security = [
  'Passwords are hashed and never stored in plain text.',
  'First-time students verify by email or phone with a single-use code.',
  'Every sensitive action is written to an audit log.',
  'Each university keeps its own isolated data.',
];

export default function Landing() {
  return (
    <>
      <section id="top" className="hero">
        <div className="wrap hero-grid">
          <div>
            <h1>One system for every student record, course and payment.</h1>
            <p className="lead">ISDMS is a university ERP and student information system. It replaces spreadsheets and disconnected tools with a single, secure platform.</p>
            <p className="hero-sub">Built in Bangladesh by TD-X Lab.</p>
          </div>
          <SystemStatus />
        </div>
      </section>

      <section id="features" className="section">
        <div className="wrap">
          <h2>What ISDMS covers</h2>
          <ul className="feature-list">
            {features.map(([t, d]) => (
              <li key={t}><h3>{t}</h3><p>{d}</p></li>
            ))}
          </ul>
        </div>
      </section>

      <section id="security" className="section tint">
        <div className="wrap split">
          <div>
            <h2>Security by default</h2>
            <p>Student and financial data is sensitive. ISDMS is built so that the safe path is the only path.</p>
          </div>
          <ul className="check-list">{security.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      </section>

      <section id="migration" className="section">
        <div className="wrap split">
          <div>
            <h2>Move from your current system</h2>
            <p>Import from Excel, CSV or another database. Map old fields to ISDMS fields, preview the result and approve it before anything is written.</p>
          </div>
          <table className="map-table">
            <caption>Example field mapping</caption>
            <thead><tr><th scope="col">Old system</th><th scope="col">ISDMS</th></tr></thead>
            <tbody>
              <tr><td>student_name</td><td>full_name</td></tr>
              <tr><td>mobile</td><td>phone</td></tr>
              <tr><td>email_address</td><td>email</td></tr>
              <tr><td>dept_name</td><td>department</td></tr>
              <tr><td>batch_no</td><td>batch</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="about" className="section tint">
        <div className="wrap narrow">
          <h2>About ISDMS</h2>
          <p>The Integrated Student Database Management System is designed as a licensed product for universities. It is made to run on a standard Linux server with Nginx, Node.js and MySQL, and to serve more than one university from the same platform.</p>
          <p>Developer: TD-X Lab.</p>
        </div>
      </section>

      <section id="contact" className="section">
        <div className="wrap narrow">
          <h2>Contact</h2>
          <p>To discuss a deployment for your university, contact TD-X Lab. Contact details will be added in the Developer panel in a later phase.</p>
        </div>
      </section>
    </>
  );
}
