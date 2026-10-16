import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { remoteBrowser, type RemoteNotificationState } from '../lib/desktop';
import { ghostButton, secondaryButton } from './buttonStyles';
import { SettingRow } from './settingsKit';
import { Switch } from './Switch';

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
  return (
    <div className="mx-auto max-w-xl space-y-3 pb-10">
      <section className="rounded-2xl bg-droid-surface p-5">
        <h2 className="text-[16px] font-semibold tracking-tight text-droid-text">Remote</h2>
        <p className="mt-0.5 text-[12px] text-droid-text-muted">
          This browser runs DROIDEX from your laptop (@{controls.handle}).
        </p>
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-droid-elevated/60 px-3 py-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-droid-green" aria-hidden />
          <p className="min-w-0 text-[12px] leading-[18px]">
            <span className="font-medium text-droid-text">Paired</span>
            <span className="text-droid-text-muted"> · {trustLabel(controls.trustedUntil())}</span>
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-droid-surface px-1 py-2">
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
          {confirmingForget ? (
            <div className="flex gap-2">
              <button
                className={`${secondaryButton} text-droid-red`}
                disabled={busy}
                onClick={() => void run(() => controls.forget())}
              >
                Forget
              </button>
              <button
                className={ghostButton}
                disabled={busy}
                onClick={() => {
                  setConfirmingForget(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className={secondaryButton}
              onClick={() => {
                setConfirmingForget(true);
              }}
            >
              Forget…
            </button>
          )}
        </SettingRow>
      </section>

      {error && (
        <p role="alert" className="px-1 text-[12px] leading-5 text-droid-red">
          {error}
        </p>
      )}

      <p className="flex gap-2 px-1 pt-1 text-[11px] leading-[18px] text-droid-text-muted">
        <ShieldCheck size={13} className="mt-0.5 shrink-0" />
        Everything between this browser and your laptop is end-to-end encrypted. Manage paired
        devices in Settings → Remote on the laptop.
      </p>
    </div>
  );
}
