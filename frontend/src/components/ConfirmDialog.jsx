import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <p>{message}</p>
      <div className="dialog-actions">
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={danger ? 'btn btn-danger' : 'btn btn-solid'} onClick={onConfirm} disabled={busy}>{busy ? 'Working...' : confirmLabel}</button>
      </div>
    </dialog>
  );
}
