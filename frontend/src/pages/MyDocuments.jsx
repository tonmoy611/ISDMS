import { useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api.js';
import DocumentRequest from '../components/DocumentRequest.jsx';
import DocumentTable from '../components/DocumentTable.jsx';

export default function MyDocuments() {
  const [opts, setOpts] = useState(null);
  const [docs, setDocs] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/documents/me/options').then((r) => (r.ok ? setOpts(r.body.data) : setError(errorMessage(r))));
    api('/documents/me').then((r) => r.ok && setDocs(r.body.data.documents));
  }, []);
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!opts) return <p className="page-loading" role="status">Loading...</p>;
  return (
    <section className="panel">
      <h1>My documents</h1>
      <DocumentRequest base="/documents/me" semesters={opts.semesters} studentNote="Your transcript here is a student copy. For an official transcript, ask the university office. The admit card needs a confirmed registration and enough attendance." />
      <h2>Issued to me</h2>
      <DocumentTable documents={docs} />
    </section>
  );
}
