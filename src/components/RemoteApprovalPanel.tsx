import { Laptop, Smartphone } from 'lucide-react';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { ghostButton, primaryButton } from './buttonStyles';

export function RemoteApprovalPanel() {
  const { state, error, busy, run } = useRemoteAccess();
  const request = state?.pending[0];
  if (!request || !window.droidControl) return null;
  const api = window.droidControl;
  return (
    <div
      className="droid-rise fixed bottom-4 right-4 rounded-2xl bg-droid-raised p-5 shadow-droid"
      style={{ zIndex: 100, width: 'min(400px,calc(100vw - 32px))' }}
      role="dialog"
      aria-label={request.title}
      aria-describedby="remote-request-detail"
    >
      <p className="mb-2 flex items-center gap-1.5 text-[11px] text-droid-text-muted">
        {request.kind === 'device' ? <Smartphone size={12} /> : <Laptop size={12} />}
        DROIDEX Remote · {request.kind === 'device' ? 'New device' : 'Approval needed'}
      </p>
      <h2 className="text-[15px] font-semibold text-droid-text">{request.title}</h2>
      <p
        id="remote-request-detail"
        className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[12px] text-droid-text-secondary"
      >
        {request.detail}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-droid-red">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          disabled={busy}
          className={`${primaryButton} flex-1`}
          onClick={() => void run(() => api.decideRemoteRequest(request.id, true))}
        >
          Approve
        </button>
        <button
          disabled={busy}
          className={`${ghostButton} flex-1`}
          onClick={() => void run(() => api.decideRemoteRequest(request.id, false))}
        >
          Deny
        </button>
      </div>
      {state.pending.length > 1 && (
        <p className="mt-2 text-[11px] text-droid-text-muted">
          {state.pending.length - 1} more waiting
        </p>
      )}
    </div>
  );
}
