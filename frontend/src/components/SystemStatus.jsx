import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

const rowLabel = { api: 'API server', database: 'Database', version: 'Version' };

export default function SystemStatus() {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    api('/health')
      .then(({ body }) => alive && setState({ loading: false, data: body?.data }))
      .catch(() => alive && setState({ loading: false, offline: true }));
    return () => { alive = false; };
  }, []);

  let rows;
  if (state.loading) rows = [['api', 'Checking...', 'wait'], ['database', 'Checking...', 'wait']];
  else if (state.offline || !state.data) rows = [['api', 'Not reachable', 'bad'], ['database', 'Unknown', 'wait']];
  else rows = [
    ['api', 'Running', 'ok'],
    ['database', state.data.database.status === 'up' ? `Connected (${state.data.database.latencyMs} ms)` : 'Not connected', state.data.database.status === 'up' ? 'ok' : 'bad'],
    ['version', `v${state.data.version}`, 'plain'],
  ];

  return (
    <aside className="ledger" aria-live="polite" aria-label="Live system status">
      <h2>Live system status</h2>
      <dl>
        {rows.map(([k, v, tone]) => (
          <div key={k} className="ledger-row">
            <dt>{rowLabel[k]}</dt>
            <dd className={`tone-${tone}`}>{tone !== 'plain' && <i aria-hidden="true" />}{v}</dd>
          </div>
        ))}
      </dl>
      <p className="ledger-note">Read directly from the running backend, not a mock.</p>
    </aside>
  );
}
