export const taka = (n) => `৳ ${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const stateLabel = { paid: 'Paid', partial: 'Partly paid', unpaid: 'Unpaid', overdue: 'Overdue', cancelled: 'Cancelled' };
export const stateBadge = (s) => (s === 'paid' ? 'active' : s === 'overdue' ? 'blocked' : s === 'cancelled' ? 'inactive' : 'pending_verification');
