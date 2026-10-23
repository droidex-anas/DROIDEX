import { Monitor } from '@droidex/icons';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { Button } from './ui/Button';

// The toast stack (.toast-stack in index.css) rests on the panel's top edge.
function publishApprovalPanelOffset(panel: HTMLDivElement) {
  const root = document.documentElement;
  const observer = new ResizeObserver(() => {
    const style = getComputedStyle(panel);
    const offsetPx = parseFloat(style.bottom) + parseFloat(style.height);
    root.style.setProperty('--approval-panel-offset', `${String(offsetPx)}px`);
  });
  observer.observe(panel);
  return () => {
    observer.disconnect();
    root.style.removeProperty('--approval-panel-offset');
  };
}

export function RemoteApprovalPanel() {
  const { state, error, busy, run } = useRemoteAccess();
  const request = state?.pending[0];
  if (!request || !window.droidex) return null;
  const api = window.droidex;
  return (
    <div
      key={request.id}
      ref={publishApprovalPanelOffset}
      // Toasts move up above this panel; z-tooltip keeps Approve and Deny on top while they do.
      className="droid-rise fixed bottom-4 right-4 z-tooltip w-96 rounded-xl bg-raised p-5 shadow-lg"
      role="dialog"
      aria-label={request.title}
      aria-describedby="remote-request-detail"
    >
      <div className="flex gap-3">
        <span className="grid size-control-lg shrink-0 place-items-center rounded-md bg-elevated text-secondary">
          <Monitor className="size-icon-lg" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted">Remote · New device</p>
          <h2 className="mt-0.5 text-subheading text-primary">{request.title}</h2>
          <p
            id="remote-request-detail"
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-body text-secondary"
          >
            {request.detail}
          </p>
        </div>
      </div>
      <p className="mt-3 text-caption text-muted">
        It gets full use of DROIDEX on this laptop. Approve only a device you just unlocked
        yourself.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-body text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        {state.pending.length > 1 && (
          <p className="mr-auto text-caption text-muted">{state.pending.length - 1} more waiting</p>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => api.decideRemoteRequest(request.id, false))}
        >
          Deny
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void run(() => api.decideRemoteRequest(request.id, true))}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
