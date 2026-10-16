import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const links = [
  ['Features', '/#features'],
  ['Security', '/#security'],
  ['Migration', '/#migration'],
  ['About', '/#about'],
  ['Contact', '/#contact'],
  ['Verify a document', '/verify-document'],
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <header className="nav">
      <a className="skip" href="#main">Skip to content</a>
      <div className="nav-inner">
        <a className="brand" href="/" aria-label="ISDMS home">
          <span className="brand-mark" aria-hidden="true">I</span>
          <span>ISDMS</span>
        </a>
        <button className="nav-toggle" aria-expanded={open} aria-controls="nav-links" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Menu'}
        </button>
        <nav id="nav-links" className={open ? 'nav-links open' : 'nav-links'}>
          {links.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
          ))}
          <Link className="nav-cta" to={user ? '/dashboard' : '/login'} onClick={() => setOpen(false)}>{user ? 'Dashboard' : 'Login'}</Link>
        </nav>
      </div>
    </header>
  );
}
