import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import DocumentRequest from '../components/DocumentRequest.jsx';
import DocumentTable from '../components/DocumentTable.jsx';

export default function StudentDocuments() {
  const { id } = useParams();
  const { can } = useAuth();
  const [semesters, setSemesters] = useState([]);
  const [docs, setDocs] = useState([]);
  useEffect(() => {
    api(`/documents/students/${id}`).then((r) => r.ok && setDocs(r.body.data.documents));
    api(`/students/${id}`).then(async (s) => {
      if (!s.ok) return;
      const r = await api(`/structure/semesters?pageSize=200&universityId=${s.body.data.student.universityId}`);
      if (r.ok) setSemesters(r.body.data.items);
    });
  }, [id]);
  return (
    <section className="panel">
      <p><Link to={`/students/${id}`}>Back to student</Link></p>
      <h1>Documents</h1>
      <DocumentRequest base={`/documents/students/${id}`} semesters={semesters} allowOverride={can('documents.override')} />
      <h2>Issued</h2>
      <DocumentTable documents={docs} />
    </section>
  );
}
