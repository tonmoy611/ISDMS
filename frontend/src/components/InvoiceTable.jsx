import { Link } from 'react-router-dom';
import { taka } from '../services/money.js';
import StateBadge from './StateBadge.jsx';

export default function InvoiceTable({ invoices, showStudent }) {
  if (!invoices.length) return <p className="empty">No invoices.</p>;
  return (
    <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Invoice</th>{showStudent && <th>Student</th>}<th>For</th><th>Total</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>{invoices.map((i) => (
        <tr key={i.id}>
          <td><Link to={`/finance/invoices/${i.id}`}>{i.number}</Link></td>
          {showStudent && <td>{i.student.name} ({i.student.code})</td>}
          <td>{i.type === 'semester' ? i.semesterName : i.type === 'admission' ? 'Admission' : 'Other'}</td>
          <td>{taka(i.total)}</td><td>{taka(i.paid)}</td><td>{taka(i.balance)}</td><td>{i.state === 'paid' || i.state === 'cancelled' ? '-' : i.nextDueDate || i.dueDate}</td>
          <td><StateBadge state={i.state} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
