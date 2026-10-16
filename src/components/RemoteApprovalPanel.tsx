import { MonitorSmartphone } from 'lucide-react';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { ghostButton, primaryButton } from './buttonStyles';

export function RemoteApprovalPanel() {
  const { state, error, busy, run } = useRemoteAccess();
  const request = state?.pending[0];
  if (!request || !window.droidControl) return null;
  const api = window.droidControl;
  return (
    <div
      key={request.id}
      // Above the toasts in the same corner: a toast must never cover Approve or Deny.
      className="droid-rise fixed bottom-4 right-4 z-[1310] w-[min(380px,calc(100vw-32px))] rounded-2xl bg-droid-raised p-5 shadow-droid"
      role="dialog"
      aria-label={request.title}
      aria-describedby="remote-request-detail"
    >
      <div className="flex gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-droid-elevated text-droid-text-secondary">
          <MonitorSmartphone size={18} strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-droid-text-muted">DROIDEX Remote · New device</p>
          <h2 className="mt-0.5 text-[14px] font-semibold text-droid-text">{request.title}</h2>
          <p
            id="remote-request-detail"
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[12px] text-droid-text-secondary"
          >
            {request.detail}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-[17px] text-droid-text-muted">
        It gets full use of DROIDEX on this laptop. Approve only a device you just unlocked
        yourself.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-droid-red">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {state.pending.length > 1 && (
          <p className="mr-auto self-center text-[11px] text-droid-text-muted">
            {state.pending.length - 1} more waiting
          </p>
        )}
        <button
          disabled={busy}
          className={ghostButton}
          onClick={() => void run(() => api.decideRemoteRequest(request.id, false))}
        >
          Deny
        </button>
        <button
          disabled={busy}
          className={primaryButton}
          onClick={() => void run(() => api.decideRemoteRequest(request.id, true))}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
