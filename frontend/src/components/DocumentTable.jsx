import { Link } from 'react-router-dom';

export default function DocumentTable({ documents, showStudent }) {
  if (!documents.length) return <p className="empty">No documents yet.</p>;
  return (
    <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Serial</th><th>Document</th>{showStudent && <th>Student</th>}<th>Issued</th><th>Status</th></tr></thead>
      <tbody>{documents.map((d) => (
        <tr key={d.id}>
          <td><Link to={`/documents/${d.id}`}>{d.serial}</Link></td><td>{d.title}</td>{showStudent && <td>{d.studentName} ({d.studentCode})</td>}
          <td>{String(d.issuedAt).slice(0, 10)}</td>
          <td>{d.revoked ? <span className="badge badge-blocked">Revoked</span> : d.isOfficial ? <span className="badge badge-active">Official</span> : <span className="badge badge-inactive">Student copy</span>}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
