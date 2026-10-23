import { AnimatePresence } from 'framer-motion';
import { useRef, useState } from 'react';
import { ShieldCheck } from '@droidex/icons';
import type { RemoteDevice, RemoteState, TrustDays } from '../../packages/remote/src/desktop';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { RemoteOnboarding } from './RemoteOnboarding';
import { RemotePairingCode } from './RemotePairing';
import { Dropdown, GroupLabel, SectionTitle, SettingRow } from './settingsKit';
import { Switch } from './Switch';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Dialog, DialogActions, DialogTitle } from './ui/Dialog';

const DAY_MS = 86_400_000;
const TRUST_OPTIONS: { value: TrustDays; label: string }[] = [
  { value: 0, label: 'Ask every time' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

type Run = (action: () => Promise<RemoteState>) => Promise<boolean>;

const STATUS_BADGE: Record<
  RemoteState['status'],
  { tone: 'success' | 'neutral' | 'danger'; label: string }
> = {
  connected: { tone: 'success', label: 'Live' },
  connecting: { tone: 'neutral', label: 'Connecting' },
  error: { tone: 'danger', label: 'Can’t reach relay' },
  off: { tone: 'neutral', label: 'Off' },
};

function connectionDetail(state: RemoteState) {
  if (state.status === 'connected')
    return `Paired devices reach @${state.profile.username}, end-to-end encrypted.`;
  if (state.status === 'connecting') return 'Reaching the relay…';
  if (state.status === 'error') return state.error ?? 'Retrying the relay connection.';
  return 'Paired devices can’t reach this laptop.';
}

export function RemoteSettings({ claimUsername = false }: { claimUsername?: boolean }) {
  const { state, error, busy, run, setError } = useRemoteAccess();
  if (!state)
    return (
      <p className="text-body text-muted" role={error ? 'alert' : 'status'}>
        {error || 'Loading Remote…'}
      </p>
    );
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <SectionTitle
        title="Remote"
        sub="Use DROIDEX on this laptop from your phone, tablet or another computer."
      />
      {state.devices.length === 0 ? (
        <RemoteOnboarding
          state={state}
          busy={busy}
          error={error}
          run={run}
          setError={setError}
          startAtUsername={claimUsername}
        />
      ) : (
        <RemoteManagement state={state} busy={busy} error={error} run={run} setError={setError} />
      )}
    </div>
  );
}

function RemoteManagement({
  state,
  busy,
  error,
  run,
  setError,
}: {
  state: RemoteState;
  busy: boolean;
  error: string;
  run: Run;
  setError: (message: string) => void;
}) {
  const api = window.droidex;
  if (!api) return null;
  const badge = STATUS_BADGE[state.status];
  return (
    <>
      <div className="mb-8 rounded-xl bg-surface shadow-lg">
        <SettingRow
          label={
            <span className="flex items-center gap-2">
              Remote access
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </span>
          }
          description={connectionDetail(state)}
        >
          <Switch
            label="Remote access"
            checked={state.enabled}
            disabled={busy}
            onChange={(enabled) => {
              void run(() => api.configureRemote({ enabled }));
            }}
          />
        </SettingRow>
      </div>
      {error && (
        <p role="alert" className="-mt-6 mb-8 px-4 text-body text-danger">
          {error}
        </p>
      )}

      <GroupLabel>Trusted devices</GroupLabel>
      <div className="mb-8 rounded-xl bg-surface shadow-lg">
        {state.devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            busy={busy}
            revoke={() => {
              void run(() => api.revokeRemoteDevice(device.id));
            }}
          />
        ))}
        <AddDevice pairingUrl={state.enabled ? state.pairingUrl : undefined} setError={setError} />
      </div>

      <GroupLabel>Security</GroupLabel>
      <div className="mb-8 rounded-xl bg-surface shadow-lg">
        <SettingRow label="Trust new devices for" description="Existing devices keep their expiry.">
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
        <ResetPairing busy={busy} reset={() => run(() => api.resetRemotePairing())} />
      </div>

      <p className="flex gap-2 px-4 text-caption text-muted">
        <ShieldCheck className="mt-0.5 size-icon-sm shrink-0" aria-hidden="true" />
        New devices need this laptop’s approval. A paired browser runs the full app, so pair only
        devices you trust. The laptop must be on, awake and running DROIDEX.
      </p>
    </>
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

function DeviceRow({
  device,
  busy,
  revoke,
}: {
  device: RemoteDevice;
  busy: boolean;
  revoke: () => void;
}) {
  return (
    <SettingRow
      label={device.name}
      description={`${lastSeenLabel(device.lastSeenAt)} · ${expiryLabel(device.expiresAt)}`}
    >
      <Button variant="ghost" disabled={busy} aria-label={`Revoke ${device.name}`} onClick={revoke}>
        Revoke
      </Button>
    </SettingRow>
  );
}

function AddDevice({
  pairingUrl,
  setError,
}: {
  pairingUrl: string | undefined;
  setError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const showing = open && pairingUrl !== undefined;
  return (
    <>
      <SettingRow
        label="Add a device"
        description={
          pairingUrl
            ? 'Show a pairing code for your phone or another computer.'
            : 'Turn Remote on to pair another device.'
        }
      >
        <Button
          disabled={!pairingUrl}
          aria-expanded={showing}
          aria-controls="remote-add-device"
          onClick={() => {
            setOpen(!open);
          }}
        >
          {showing ? 'Done' : 'Show code'}
        </Button>
      </SettingRow>
      <div id="remote-add-device" className="expand-rows" data-open={showing || undefined}>
        <div
          inert={!showing}
          className={cn(
            'min-h-0 overflow-hidden transition-opacity duration-150 ease-out',
            !showing && 'opacity-0',
          )}
        >
          <div className="px-4 pb-4 pt-1">
            {pairingUrl && (
              <RemotePairingCode key={pairingUrl} url={pairingUrl} setError={setError} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ResetPairing({ busy, reset }: { busy: boolean; reset: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setConfirming(false);
  };
  return (
    <>
      <SettingRow
        label="Reset pairing"
        description="Revokes every device and replaces the authenticator."
      >
        <Button
          variant="danger"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Reset…
        </Button>
      </SettingRow>
      <AnimatePresence>
        {confirming && (
          <Dialog
            role="alertdialog"
            onClose={close}
            dismissible={!busy}
            initialFocusRef={cancelRef}
            aria-describedby="remote-reset-description"
          >
            <DialogTitle>Reset Remote pairing?</DialogTitle>
            <p id="remote-reset-description" className="mt-3 text-body text-secondary">
              Remote turns off, every device is revoked and you link a new authenticator. Your
              username and shared profile links keep working.
            </p>
            <DialogActions>
              <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={busy}
                onClick={() => {
                  void reset().then((saved) => {
                    if (saved) close();
                  });
                }}
              >
                Reset all devices
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
}
