import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RemoteDevice, RemoteState, TrustDays } from '../../packages/remote/src/desktop';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { ghostButton, secondaryButton } from './buttonStyles';
import { RemoteOnboarding } from './RemoteOnboarding';
import { RemotePairingCode } from './RemotePairing';
import { Dropdown, SettingRow } from './settingsKit';
import { Switch } from './Switch';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const DAY_MS = 86_400_000;
const TRUST_OPTIONS: { value: TrustDays; label: string }[] = [
  { value: 0, label: 'Ask every time' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

const STATUS_TONE: Record<RemoteState['status'], { dot: string; label: string }> = {
  connected: { dot: 'bg-droid-green', label: 'Connected' },
  connecting: { dot: 'bg-droid-text-muted motion-safe:animate-pulse', label: 'Connecting' },
  error: { dot: 'bg-droid-red', label: 'Can’t reach relay' },
  off: { dot: 'bg-droid-text-muted/40', label: 'Off' },
};

function connectionDetail(state: RemoteState) {
  if (state.status === 'connected') return 'End-to-end encrypted to your paired devices.';
  if (state.status === 'connecting') return 'Reaching the relay…';
  if (state.status === 'error') return state.error ?? 'Retrying the relay connection.';
  return state.authenticatorReady
    ? 'Paired devices cannot reach this laptop.'
    : 'Finish setup to reach this laptop from your phone.';
}

export function RemoteSettings() {
  const { state, error, busy, run, setError } = useRemoteAccess();
  if (!state)
    return (
      <p className="text-[13px] text-droid-text-muted" role={error ? 'alert' : 'status'}>
        {error || 'Loading Remote…'}
      </p>
    );
  const api = window.droidControl;
  if (!api) return null;
  const paired = state.devices.length > 0;
  const tone = STATUS_TONE[state.status];
  return (
    <div className="mx-auto max-w-xl space-y-3 pb-10">
      <section className="rounded-2xl bg-droid-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-droid-text">Remote</h2>
            <p className="mt-0.5 text-[12px] text-droid-text-muted">
              Your laptop does the work. Your phone keeps you in the loop.
            </p>
          </div>
          {state.authenticatorReady && (
            <Switch
              label="Remote access"
              checked={state.enabled}
              disabled={busy}
              onChange={(enabled) => {
                void run(() => api.configureRemote({ enabled }));
              }}
            />
          )}
        </div>
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-droid-elevated/60 px-3 py-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
          <p className="min-w-0 text-[12px] leading-[18px]">
            <span className="font-medium text-droid-text">{tone.label}</span>
            <span className="text-droid-text-muted"> · {connectionDetail(state)}</span>
          </p>
        </div>
      </section>

      {error && (
        <p role="alert" className="px-1 text-[12px] leading-5 text-droid-red">
          {error}
        </p>
      )}

      {!paired && (
        <section className="rounded-2xl bg-droid-surface p-5">
          <RemoteOnboarding state={state} busy={busy} run={run} setError={setError} />
        </section>
      )}

      {paired && (
        <TrustedDevices
          devices={state.devices}
          busy={busy}
          revoke={(id) => {
            void run(() => api.revokeRemoteDevice(id));
          }}
          pairing={
            <RemotePairingCode
              key={state.pairingUrl}
              url={state.enabled ? state.pairingUrl : undefined}
              setError={setError}
            />
          }
        />
      )}

      {state.authenticatorReady && (
        <section className="rounded-2xl bg-droid-surface px-1 py-2">
          <SettingRow
            label="Trust new devices for"
            description="Existing devices keep their expiry."
          >
            <Dropdown
              ariaLabel="Device trust duration"
              value={String(state.trustDays)}
              options={TRUST_OPTIONS.map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              onChange={(value) => {
                const choice = TRUST_OPTIONS.find((option) => String(option.value) === value);
                if (choice) void run(() => api.configureRemote({ trustDays: choice.value }));
              }}
            />
          </SettingRow>
          <SettingRow
            label="Keep laptop awake"
            description="While Remote is on. Closing the lid may still sleep it."
          >
            <Switch
              label="Keep laptop awake"
              checked={state.keepAwake}
              disabled={busy}
              onChange={(keepAwake) => {
                void run(() => api.configureRemote({ keepAwake }));
              }}
            />
          </SettingRow>
          <SettingRow
            label="Folder for new tasks"
            description={
              <span className="block max-w-[260px] truncate" title={state.workspace || undefined}>
                {state.workspace || 'Tasks start without a project folder.'}
              </span>
            }
          >
            <button
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                void run(async () => {
                  const workspace = await api.pickDirectory();
                  return workspace ? api.configureRemote({ workspace }) : state;
                });
              }}
            >
              Choose
            </button>
          </SettingRow>
        </section>
      )}

      {state.authenticatorReady && (
        <>
          <p className="flex gap-2 px-1 pt-1 text-[11px] leading-[18px] text-droid-text-muted">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            New devices and risky actions need this laptop’s approval, and Remote tasks run
            Supervised. The laptop must be on, awake and running DROIDEX.
          </p>
          <ResetPairing busy={busy} reset={() => run(() => api.resetRemotePairing())} />
        </>
      )}
    </div>
  );
}

function expiryLabel(expiresAt: number) {
  const days = Math.ceil((expiresAt - Date.now()) / DAY_MS);
  if (days <= 0) return 'Expired';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 14) return `Expires in ${String(days)} days`;
  return `Expires ${new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function lastSeenLabel(lastSeenAt: number) {
  if (!lastSeenAt) return 'Not seen yet';
  return `Seen ${new Date(lastSeenAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function TrustedDevices({
  devices,
  busy,
  revoke,
  pairing,
}: {
  devices: RemoteDevice[];
  busy: boolean;
  revoke: (id: string) => void;
  pairing: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="rounded-2xl bg-droid-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-droid-text">Trusted devices</h3>
        <button
          className={ghostButton}
          aria-expanded={adding}
          onClick={() => {
            setAdding(!adding);
          }}
        >
          {adding ? 'Done' : 'Pair another'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mb-4 rounded-xl bg-droid-elevated/50 p-4">{pairing}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <ul className="space-y-1.5">
        {devices.map((device) => (
          <li
            key={device.id}
            className="flex items-center gap-3 rounded-xl bg-droid-elevated/50 px-3 py-2.5"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-droid-surface text-droid-text-secondary">
              <Smartphone size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-droid-text">{device.name}</p>
              <p className="text-[11px] text-droid-text-muted">
                {lastSeenLabel(device.lastSeenAt)} · {expiryLabel(device.expiresAt)}
              </p>
            </div>
            <button
              className={ghostButton}
              disabled={busy}
              onClick={() => {
                revoke(device.id);
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResetPairing({ busy, reset }: { busy: boolean; reset: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="px-1">
      <button
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setConfirming(false);
        }}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[12px] text-droid-text-muted transition-colors hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/40"
      >
        <ChevronRight
          size={13}
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        Reset pairing
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-droid-surface p-4">
          <p className="text-[12px] leading-[18px] text-droid-text-muted">
            Turns Remote off, revokes every device and replaces the authenticator. Your laptop
            identity and shared profile links keep working.
          </p>
          <div className="mt-3 flex gap-2">
            {confirming ? (
              <>
                <button
                  className={`${secondaryButton} text-droid-red`}
                  disabled={busy}
                  onClick={() => {
                    void reset().then((saved) => {
                      if (saved) {
                        setConfirming(false);
                        setOpen(false);
                      }
                    });
                  }}
                >
                  Reset all devices
                </button>
                <button
                  className={ghostButton}
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className={secondaryButton}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Reset…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
