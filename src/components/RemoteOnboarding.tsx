import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, Laptop, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RemoteState } from '../../packages/remote/src/desktop';
import { ghostButton } from './buttonStyles';
import { RemoteAddressForm } from './RemoteAddressForm';
import { RemoteAuthenticatorSetup, RemotePairingCode } from './RemotePairing';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type StepStatus = 'done' | 'active' | 'upcoming';

const MARKER_TONE: Record<StepStatus, string> = {
  done: 'bg-droid-green/15 text-droid-green',
  active: 'bg-droid-text text-droid-bg',
  upcoming: 'bg-droid-elevated text-droid-text-muted',
};
const STATUS_LABEL: Record<StepStatus, string> = {
  done: ' (done)',
  active: ' (current step)',
  upcoming: '',
};

function Step({
  number,
  title,
  status,
  last,
  summary,
  children,
}: {
  number: number;
  title: string;
  status: StepStatus;
  last?: boolean;
  summary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-4">
      {!last && (
        <span
          aria-hidden
          className={`absolute left-[13px] top-8 bottom-0 w-[2px] rounded-full transition-colors duration-300 ${
            status === 'done' ? 'bg-droid-green/40' : 'bg-droid-elevated'
          }`}
        />
      )}
      <span
        aria-hidden
        className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-medium tabular-nums transition-colors duration-300 ${MARKER_TONE[status]}`}
      >
        {status === 'done' ? <Check size={14} strokeWidth={2.5} /> : number}
      </span>
      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-7'}`}>
        <h3
          className={`pt-1 text-[13px] font-medium ${
            status === 'upcoming' ? 'text-droid-text-muted' : 'text-droid-text'
          }`}
        >
          {title}
          <span className="sr-only">{STATUS_LABEL[status]}</span>
        </h3>
        {summary && status !== 'active' && <div className="mt-1">{summary}</div>}
        <AnimatePresence initial={false}>
          {status === 'active' && children && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="pt-3">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

function stepStatus(done: boolean, reachable: boolean): StepStatus {
  if (done) return 'done';
  return reachable ? 'active' : 'upcoming';
}

// Four steps derived from Remote state: identity, authenticator, the other
// device, and the laptop's approval of it. A step is done once state proves it.
export function RemoteOnboarding({
  state,
  busy,
  run,
  setError,
}: {
  state: RemoteState;
  busy: boolean;
  run: (action: () => Promise<RemoteState>) => Promise<boolean>;
  setError: (message: string) => void;
}) {
  const [editingIdentity, setEditingIdentity] = useState(false);
  const api = window.droidControl;
  if (!api) return null;
  const identityReady = state.profile.displayName !== '' && state.profile.username !== '';
  const hostingReady = state.relayUrl !== '' && state.clientUrl !== '';
  const paired = state.devices.length > 0;
  const deviceRequest = state.pending.at(0);
  const identityDone = identityReady && !editingIdentity;
  const deviceDone = paired || deviceRequest !== undefined;

  return (
    <ol aria-label="Set up Remote">
      <Step
        number={1}
        title="Choose a username"
        status={stepStatus(identityDone, true)}
        summary={
          identityReady && (
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate text-[12px] text-droid-text-muted">
                {state.profile.displayName} · @{state.profile.username}
              </p>
              {!state.authenticatorReady && (
                <button
                  aria-label="Edit name and username"
                  className={`${ghostButton} h-6 px-1.5`}
                  onClick={() => {
                    setEditingIdentity(true);
                  }}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )
        }
      >
        <RemoteAddressForm
          key={JSON.stringify([state.profile, state.relayUrl, state.clientUrl])}
          settings={state}
          busy={busy}
          save={async (patch) => {
            if (await run(() => api.configureRemote(patch))) setEditingIdentity(false);
          }}
          cancel={
            identityReady
              ? () => {
                  setEditingIdentity(false);
                }
              : undefined
          }
        />
      </Step>

      <Step
        number={2}
        title="Link an authenticator app"
        status={stepStatus(state.authenticatorReady, identityDone)}
        summary={
          state.authenticatorReady && (
            <p className="text-[12px] text-droid-text-muted">Authenticator linked.</p>
          )
        }
      >
        {hostingReady ? (
          <RemoteAuthenticatorSetup busy={busy} run={run} setError={setError} />
        ) : (
          <p className="flex gap-2 rounded-xl bg-droid-elevated/60 px-3 py-2.5 text-[12px] leading-[18px] text-droid-text-secondary">
            <Info size={14} className="mt-0.5 shrink-0 text-droid-text-muted" />
            This build has no Remote relay yet. To self-host, edit step 1 and add your relay under
            Advanced → Self-host Remote.
          </p>
        )}
      </Step>

      <Step
        number={3}
        title="Open DROIDEX on your other device"
        status={stepStatus(deviceDone, state.authenticatorReady)}
        summary={
          paired && (
            <p className="text-[12px] text-droid-text-muted">
              {state.devices.length === 1
                ? '1 device paired.'
                : `${String(state.devices.length)} devices paired.`}
            </p>
          )
        }
      >
        <RemotePairingCode
          key={state.pairingUrl}
          url={state.enabled ? state.pairingUrl : undefined}
          setError={setError}
        />
      </Step>

      <Step
        number={4}
        title="Approve it on this laptop"
        status={stepStatus(paired, deviceRequest !== undefined)}
        last
        summary={
          !paired && (
            <p className="text-[12px] text-droid-text-muted">
              Your device asks for access after you enter its code there.
            </p>
          )
        }
      >
        <div className="flex items-center gap-3 rounded-xl bg-droid-elevated/60 px-3 py-3">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-droid-surface text-droid-text">
            <Laptop size={15} />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-droid-green motion-safe:animate-pulse" />
          </span>
          <p className="min-w-0 text-[12px] leading-[18px] text-droid-text-secondary">
            A device is asking for access. Check that it’s the one you just unlocked, then approve
            it in the card at the bottom right.
          </p>
        </div>
      </Step>
    </ol>
  );
}
