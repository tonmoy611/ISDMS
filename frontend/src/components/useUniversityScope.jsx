import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/** Which university a screen works in. Platform admins pick one (kept in ?u=); everyone else is pinned to their own. */
export default function useUniversityScope() {
  const { user, isPlatform } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [unis, setUnis] = useState([]);
  useEffect(() => { if (isPlatform) api('/universities?pageSize=200').then((r) => r.ok && setUnis(r.body.data.items)); }, [isPlatform]);

  const universityId = isPlatform ? sp.get('u') || '' : String(user.universityId);
  const picker = isPlatform ? (
    <div className="field narrow-panel">
      <label htmlFor="uni">Working in university</label>
      <select id="uni" value={universityId} onChange={(e) => setSp(e.target.value ? { u: e.target.value } : {})}>
        <option value="">Choose a university</option>
        {unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </div>
  ) : null;
  return { universityId, picker, search: sp.toString() ? `?${sp}` : '' };
}
