import { stateBadge, stateLabel } from '../services/money.js';

export default function StateBadge({ state }) {
  return <span className={`badge badge-${stateBadge(state)}`}>{stateLabel[state] || state}</span>;
}
