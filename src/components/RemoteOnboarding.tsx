import { useState } from 'react';
import { ArrowRight } from '@droidex/icons';
import type { RemoteState } from '../../packages/remote/src/desktop';
import { RemoteArt, type RemoteArtScene } from '../features/remote/RemoteArt';
import { JourneyStep, JourneySteps } from '../features/remote/RemoteJourney';
import { RemoteAddressForm } from './RemoteAddressForm';
import { RemoteAuthenticatorSetup, RemotePairingCode } from './RemotePairing';
import { Button } from './ui/Button';

const STEPS = ['Username', 'Authenticator', 'Live'] as const;

type Step = 'intro' | 'handle' | 'authenticator' | 'live';

const STEP_INDEX: Record<Step, number> = { intro: -1, handle: 0, authenticator: 1, live: 2 };

function liveScene(state: RemoteState): RemoteArtScene {
  if (state.pending.length > 0) return 'waiting';
  if (!state.enabled || state.status === 'error') return 'offline';
  return 'live';
}

function onboardingStep(
  identityReady: boolean,
  started: boolean,
  editingIdentity: boolean,
  authenticatorReady: boolean,
): Step {
  if (!identityReady) return started ? 'handle' : 'intro';
  if (editingIdentity) return 'handle';
  return authenticatorReady ? 'live' : 'authenticator';
}

const SCENE: Record<Exclude<Step, 'live'>, RemoteArtScene> = {
  intro: 'intro',
  handle: 'handle',
  authenticator: 'key',
};

// The laptop's half of the journey, until a first device is paired. Each step
// is derived from Remote state, so leaving and coming back resumes it.
export function RemoteOnboarding({
  state,
  busy,
  error,
  run,
  setError,
  startAtUsername,
}: {
  state: RemoteState;
  busy: boolean;
  error: string;
  run: (action: () => Promise<RemoteState>) => Promise<boolean>;
  setError: (message: string) => void;
  /** Skip the intro, for a "Claim your username" call to action. */
  startAtUsername: boolean;
}) {
  const [started, setStarted] = useState(startAtUsername);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const api = window.droidex;
  if (!api) return null;
  const identityReady = state.profile.displayName !== '' && state.profile.username !== '';
  const step = onboardingStep(identityReady, started, editingIdentity, state.authenticatorReady);
  const scene = step === 'live' ? liveScene(state) : SCENE[step];

  return (
    <section className="rounded-xl bg-surface p-8 shadow-lg">
      <div className="mx-auto flex max-w-md flex-col gap-8">
        <RemoteArt scene={scene} className="mx-auto max-w-72" />
        <JourneySteps label="Set up Remote" steps={STEPS} current={STEP_INDEX[step]} />
        <div key={step === 'live' ? scene : step}>
          {step === 'intro' && (
            <JourneyStep
              level={2}
              title="Your laptop, from anywhere"
              line="Pair your phone or another computer and run DROIDEX on it. Your laptop does the work, end-to-end encrypted."
            >
              <div>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    setStarted(true);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    Get started
                    <ArrowRight className="size-icon-md" aria-hidden="true" />
                  </span>
                </Button>
              </div>
            </JourneyStep>
          )}
          {step === 'handle' && (
            <JourneyStep
              level={2}
              title="Claim your username"
              line="It becomes your Remote address, where your other devices find this laptop."
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
            </JourneyStep>
          )}
          {step === 'authenticator' && (
            <AuthenticatorStep
              state={state}
              busy={busy}
              run={run}
              setError={setError}
              changeUsername={() => {
                setEditingIdentity(true);
              }}
            />
          )}
          {step === 'live' && (
            <LiveStep state={state} scene={scene} busy={busy} run={run} setError={setError} />
          )}
        </div>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function AuthenticatorStep({
  state,
  busy,
  run,
  setError,
  changeUsername,
}: {
  state: RemoteState;
  busy: boolean;
  run: (action: () => Promise<RemoteState>) => Promise<boolean>;
  setError: (message: string) => void;
  changeUsername: () => void;
}) {
  return (
    <JourneyStep
      level={2}
      title="Link an authenticator"
      line="Every new device asks for a code from it before this laptop lets it in."
    >
      {state.relayUrl !== '' && state.clientUrl !== '' ? (
        <RemoteAuthenticatorSetup busy={busy} run={run} setError={setError} />
      ) : (
        <p className="text-body text-secondary">
          This build has no Remote relay. Add your own under Self-host Remote on the username step.
        </p>
      )}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5"
          disabled={busy}
          onClick={changeUsername}
        >
          Change @{state.profile.username}
        </Button>
      </div>
    </JourneyStep>
  );
}

function LiveStep({
  state,
  scene,
  busy,
  run,
  setError,
}: {
  state: RemoteState;
  scene: RemoteArtScene;
  busy: boolean;
  run: (action: () => Promise<RemoteState>) => Promise<boolean>;
  setError: (message: string) => void;
}) {
  const api = window.droidex;
  if (!api) return null;
  if (scene === 'waiting')
    return (
      <JourneyStep
        level={2}
        title="Approve your device"
        line="Check it’s the one you just unlocked, then choose Approve in the card at the bottom right."
      />
    );
  if (!state.enabled)
    return (
      <JourneyStep
        level={2}
        title="Remote is off"
        line="Turn it on to reach this laptop from your other devices."
      >
        <div>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={busy}
            onClick={() => {
              void run(() => api.configureRemote({ enabled: true }));
            }}
          >
            Turn on Remote
          </Button>
        </div>
      </JourneyStep>
    );
  if (state.status === 'error')
    return (
      <JourneyStep
        level={2}
        title="Can’t reach the relay"
        line={state.error ?? 'DROIDEX keeps retrying. Check this laptop’s connection.'}
      />
    );
  return (
    <JourneyStep
      level={2}
      title={state.status === 'connected' ? 'You’re live' : 'Going live…'}
      line={`Open your other device to pair it with @${state.profile.username}. You approve it here.`}
    >
      {state.pairingUrl && (
        <RemotePairingCode key={state.pairingUrl} url={state.pairingUrl} setError={setError} />
      )}
    </JourneyStep>
  );
}
