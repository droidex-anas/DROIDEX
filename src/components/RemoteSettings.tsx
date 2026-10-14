import { useState } from 'react';
import { Check, Pencil, ShieldCheck, Smartphone } from 'lucide-react';
import type { RemoteDevice, RemoteState, TrustDays } from '../../packages/remote/src/desktop';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { Dropdown, SectionTitle, SettingRow } from './settingsKit';
import { RemoteAddressForm } from './RemoteAddressForm';
import { RemoteAuthenticatorSetup, RemotePairingCode } from './RemotePairing';
import { Switch } from './Switch';

const button =
  'min-h-10 rounded-xl bg-droid-elevated px-4 py-2 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-active disabled:opacity-40';
const TRUST_OPTIONS: { value: TrustDays; label: string }[] = [
  { value: 0, label: 'Ask every time' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

function connectionLabel(state: RemoteState) {
  if (state.status === 'connected') return 'Connected and encrypted';
  if (state.status === 'off') return 'Off';
  return state.error ?? 'Reconnecting to relay';
}

export function RemoteSettings() {
  const { state, error, busy, run, setError } = useRemoteAccess();
  const [editingAddress, setEditingAddress] = useState(false);
  if (!state)
    return (
      <p className="text-[13px] text-droid-text-muted" role={error ? 'alert' : 'status'}>
        {error || 'Loading Remote…'}
      </p>
    );
  const api = window.droidControl;
  if (!api) return null;
  const addressReady = [
    state.profile.displayName,
    state.profile.username,
    state.relayUrl,
    state.clientUrl,
  ].every((value) => value.length > 0);
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <SectionTitle
        title="Remote"
        sub="Your laptop does the work. Your phone keeps you connected."
      />
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-droid-elevated px-4 py-3 text-[12px] leading-5 text-droid-red"
        >
          {error}
        </p>
      )}
      {!state.authenticatorReady && (
        <>
          <section className="space-y-4">
            <div>
              <p className="text-[11px] text-droid-text-muted">1 of 3</p>
              <h3 className="mt-1 text-[15px] font-medium text-droid-text">Your remote address</h3>
            </div>
            {!addressReady || editingAddress ? (
              <RemoteAddressForm
                key={JSON.stringify([state.profile, state.relayUrl, state.clientUrl])}
                settings={state}
                busy={busy}
                save={async (patch) => {
                  if (await run(() => api.configureRemote(patch))) setEditingAddress(false);
                }}
                cancel={
                  addressReady
                    ? () => {
                        setEditingAddress(false);
                      }
                    : undefined
                }
              />
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-droid-elevated/50 px-4 py-3">
                <Check size={16} className="text-droid-green" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-droid-text">{state.profile.displayName}</p>
                  <p className="truncate text-[12px] text-droid-text-muted">
                    {state.clientUrl.replace(/\/$/, '')}/{state.profile.username}
                  </p>
                </div>
                <button
                  className={button}
                  onClick={() => {
                    setEditingAddress(true);
                  }}
                >
                  <Pencil size={12} /> <span className="sr-only">Edit address</span>
                </button>
              </div>
            )}
          </section>
          {addressReady && !editingAddress && (
            <RemoteAuthenticatorSetup busy={busy} run={run} setError={setError} />
          )}
        </>
      )}
      {state.authenticatorReady && (
        <>
          <div className="rounded-2xl bg-droid-elevated/50">
            <SettingRow label="Remote access" description={connectionLabel(state)}>
              <Switch
                label="Remote access"
                checked={state.enabled}
                disabled={busy}
                onChange={(enabled) => {
                  void run(() => api.configureRemote({ enabled }));
                }}
              />
            </SettingRow>
            <SettingRow
              label="Trust new devices"
              description="Existing devices keep their chosen expiry."
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
              description="While Remote is on. Closing the lid may still suspend your laptop."
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
              label="New task folder"
              description={state.workspace || 'Tasks start without a project folder.'}
            >
              <button
                disabled={busy}
                className={button}
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
          </div>
          <RemotePairingCode
            key={state.pairingUrl}
            url={state.enabled ? state.pairingUrl : undefined}
            setError={setError}
          />
          <TrustedDevices
            devices={state.devices}
            busy={busy}
            revoke={(id) => {
              void run(() => api.revokeRemoteDevice(id));
            }}
          />
          <div className="flex items-start gap-2 text-[12px] leading-5 text-droid-text-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <p>
              New devices and risky actions need your laptop’s approval. Remote tasks run in
              Supervised mode. The laptop must be on, awake, and running Droidex.
            </p>
          </div>
          <ResetPairing busy={busy} reset={() => run(() => api.resetRemotePairing())} />
        </>
      )}
    </div>
  );
}

function TrustedDevices({
  devices,
  busy,
  revoke,
}: {
  devices: RemoteDevice[];
  busy: boolean;
  revoke: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-[13px] font-medium text-droid-text">Trusted devices</h3>
      {devices.length === 0 ? (
        <p className="text-[12px] text-droid-text-muted">Your paired devices will appear here.</p>
      ) : (
        devices.map((device) => (
          <div
            key={device.id}
            className="flex items-center gap-3 rounded-xl bg-droid-elevated/40 px-3 py-3"
          >
            <Smartphone size={16} className="text-droid-text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-droid-text">{device.name}</p>
              <p className="text-[11px] text-droid-text-muted">
                Expires {new Date(device.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                revoke(device.id);
              }}
            >
              Revoke
            </button>
          </div>
        ))
      )}
    </section>
  );
}

function ResetPairing({ busy, reset }: { busy: boolean; reset: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <details className="text-[12px] text-droid-text-muted">
      <summary className="cursor-pointer py-2">Reset pairing</summary>
      <p className="mt-2 leading-5">
        This turns Remote off, revokes every device and replaces the authenticator. Your laptop
        identity and shared profile links remain available.
      </p>
      <div className="mt-3 flex gap-2">
        {confirming ? (
          <>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                void reset().then((saved) => {
                  if (saved) setConfirming(false);
                });
              }}
            >
              Reset all devices
            </button>
            <button
              className={button}
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
            className={button}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Reset…
          </button>
        )}
      </div>
    </details>
  );
}
