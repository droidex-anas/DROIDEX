import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from '@droidex/icons';
import { remoteBrowser, type RemoteNotificationState } from '../lib/desktop';
import { SettingRow } from './settingsKit';
import { Switch } from './Switch';
import { Button } from './ui/Button';
import { Dialog, DialogActions, DialogTitle } from './ui/Dialog';

const NOTIFICATION_HINT: Record<RemoteNotificationState, string> = {
  on: 'Your laptop pings this browser when an agent needs you.',
  off: 'Get a ping when an agent needs you, even with this page closed.',
  unsupported: 'This browser cannot receive notifications.',
  'needs-home-screen': 'On iPhone and iPad, use Share → Add to Home Screen, then open it there.',
  'not-remembered': 'Your laptop trusts this browser for one connection only.',
};

// Your laptop can trust a browser for a single connection, which leaves no expiry to show.
function trustLabel(trustedUntil: number): string {
  if (trustedUntil <= Date.now()) return 'Trusted for this connection only';
  const until = new Date(trustedUntil).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Trusted until ${until}`;
}

/** Settings → Remote inside a paired browser: this browser's own pairing. */
export function RemoteBrowserSettings() {
  const controls = remoteBrowser();
  const [notifications, setNotifications] = useState<RemoteNotificationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingForget, setConfirmingForget] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!controls) return;
    let disposed = false;
    void controls.notifications().then(
      (state) => {
        if (!disposed) setNotifications(state);
      },
      (reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [controls]);

  if (!controls) return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const closeForget = () => {
    setConfirmingForget(false);
  };
  return (
    <div className="mx-auto max-w-xl space-y-3 pb-10">
      <section className="rounded-xl bg-surface p-5">
        <h2 className="text-subheading text-primary">Remote</h2>
        <p className="mt-0.5 text-body text-muted">
          This browser runs DROIDEX from your laptop (@{controls.handle}).
        </p>
        <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-elevated px-3 py-2.5">
          <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
          <p className="min-w-0 text-body">
            <span className="font-medium text-primary">Paired</span>
            <span className="text-muted"> · {trustLabel(controls.trustedUntil())}</span>
          </p>
        </div>
      </section>

      <section className="rounded-xl bg-surface px-1 py-2">
        <SettingRow
          label="Notifications"
          description={notifications ? NOTIFICATION_HINT[notifications] : 'Checking…'}
        >
          {(notifications === 'on' || notifications === 'off') && (
            <Switch
              label="Notifications"
              checked={notifications === 'on'}
              disabled={busy}
              onChange={(enabled) => {
                void run(async () => {
                  setNotifications(await controls.setNotifications(enabled));
                });
              }}
            />
          )}
        </SettingRow>
        <SettingRow
          label="Forget this browser"
          description="Removes this browser’s key. Pair it again from your laptop to come back."
        >
          <Button
            variant="danger"
            onClick={() => {
              setConfirmingForget(true);
            }}
          >
            Forget…
          </Button>
        </SettingRow>
      </section>

      {error && !confirmingForget && (
        <p role="alert" className="px-1 text-label text-danger">
          {error}
        </p>
      )}

      <p className="flex gap-2 px-1 pt-1 text-caption text-muted">
        <ShieldCheck className="mt-0.5 size-icon-sm shrink-0" aria-hidden="true" />
        Everything between this browser and your laptop is end-to-end encrypted. Manage paired
        devices in Settings → Remote on the laptop.
      </p>

      <AnimatePresence>
        {confirmingForget && (
          <Dialog
            role="alertdialog"
            onClose={closeForget}
            dismissible={!busy}
            initialFocusRef={cancelRef}
            aria-describedby="remote-forget-description"
          >
            <DialogTitle>Forget this browser?</DialogTitle>
            <p id="remote-forget-description" className="mt-3 text-body text-secondary">
              This browser’s key is deleted and the connection closes. To come back, pair it again
              from Settings → Remote on your laptop.
            </p>
            {error && (
              <p role="alert" className="mt-3 text-label text-danger">
                {error}
              </p>
            )}
            <DialogActions>
              <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={closeForget}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={busy}
                onClick={() => void run(() => controls.forget())}
              >
                Forget browser
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
