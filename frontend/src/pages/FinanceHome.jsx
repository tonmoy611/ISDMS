import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import useUniversityScope from '../components/useUniversityScope.jsx';
import FinanceOverview from './FinanceOverview.jsx';
import FinanceInvoices from './FinanceInvoices.jsx';
import FinancePayments from './FinancePayments.jsx';
import FinanceSetup from './FinanceSetup.jsx';

export default function FinanceHome({ tab = 'overview' }) {
  const { isPlatform } = useAuth();
  const { universityId, picker, search } = useUniversityScope();
  return (
    <section className="panel">
      <h1>Finance</h1>
      {picker}
      <nav className="tabs" aria-label="Finance sections">
        <NavLink end to={`/finance${search}`}>Overview</NavLink>
        <NavLink to={`/finance/invoices${search}`}>Invoices</NavLink>
        <NavLink to={`/finance/payments${search}`}>Payments</NavLink>
        <NavLink to={`/finance/setup${search}`}>Setup</NavLink>
      </nav>
      {isPlatform && !universityId ? <p className="empty">Choose a university above to continue.</p> : (
        <>
          {tab === 'overview' && <FinanceOverview key={universityId} universityId={universityId} />}
          {tab === 'invoices' && <FinanceInvoices key={universityId} universityId={universityId} />}
          {tab === 'payments' && <FinancePayments key={universityId} universityId={universityId} />}
          {tab === 'setup' && <FinanceSetup key={universityId} universityId={universityId} />}
        </>
      )}
    </section>
  );
}
