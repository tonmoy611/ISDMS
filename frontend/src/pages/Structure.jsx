import { useEffect, useState } from 'react';
import { Navigate, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { RESOURCES, ORDER } from '../services/structureConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import ResourceManager from '../components/ResourceManager.jsx';

export default function Structure() {
  const { resource } = useParams();
  const { user, isPlatform } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [unis, setUnis] = useState([]);
  const universityId = isPlatform ? sp.get('u') || '' : String(user.universityId);

  useEffect(() => {
    if (isPlatform) api('/universities?pageSize=200').then((r) => r.ok && setUnis(r.body.data.items));
  }, [isPlatform]);

  if (!resource) return <Navigate to={`/structure/${isPlatform ? 'universities' : 'campuses'}`} replace />;
  if (!RESOURCES[resource]) return <Navigate to="/structure" replace />;

  const search = sp.toString() ? `?${sp}` : '';
  const needsUni = resource !== 'universities' && !universityId;

  return (
    <section className="panel">
      <h1>University structure</h1>
      {isPlatform && (
        <div className="field narrow-panel">
          <label htmlFor="uni">Working in university</label>
          <select id="uni" value={universityId} onChange={(e) => setSp(e.target.value ? { u: e.target.value } : {})}>
            <option value="">Choose a university</option>
            {unis.map((u) => <option key={u.id} value={u.id}>{u.name}{u.status === 'inactive' ? ' (inactive)' : ''}</option>)}
          </select>
        </div>
      )}
      <nav className="tabs" aria-label="Structure sections">
        {ORDER.map((k) => <NavLink key={k} to={`/structure/${k}${search}`}>{RESOURCES[k].title}</NavLink>)}
      </nav>
      {needsUni
        ? <p className="empty">Choose a university above to manage its {RESOURCES[resource].title.toLowerCase()}.</p>
        : <ResourceManager key={`${resource}-${universityId}`} resource={resource} universityId={universityId} />}
    </section>
  );
}
