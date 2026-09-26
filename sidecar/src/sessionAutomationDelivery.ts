import type { AutomationDeliveryReceipt } from './automations/types.js';
import type { LiveSession, SessionLifecycleDependencies } from './SessionLifecycle.js';

interface DeliveryContext {
  dependencies: SessionLifecycleDependencies;
  canResume: () => boolean;
  resume: (appSessionId: string) => Promise<boolean>;
  start: (appSessionId: string, prompt: string, delivery: ScheduledTurnDelivery) => Promise<void>;
}

export interface ScheduledTurnDelivery {
  isCurrent: () => boolean;
  accepted: () => void;
  /** The turn stopped before the runtime was given the prompt. */
  declined: () => void;
}

/** Acceptance requires a runtime stream response, not merely a reserved turn. */
export async function deliverScheduledMessage(
  context: DeliveryContext,
  appSessionId: string,
  prompt: string,
  isCurrent: () => boolean,
): Promise<AutomationDeliveryReceipt> {
  const d = context.dependencies;
  // Until the runtime is given the prompt, a caller that withdrew the delivery
  // is told so, apart from a target that could not take it: nothing was sent.
  const refusal = (): AutomationDeliveryReceipt =>
    isCurrent()
      ? { status: 'unavailable', error: 'The scheduled target session is unavailable.' }
      : { status: 'cancelled' };
  const available = () => isCurrent() && !d.isShutdownStarted();
  const historical = d.registry.getCanonicalSummary(appSessionId);
  if (historical?.appSessionId !== appSessionId || !available()) return refusal();
  let live = d.registry.getLive(appSessionId);
  if (!live) {
    if (!context.canResume()) return { status: 'busy', retryOn: 'capacity' };
    if (!(await context.resume(appSessionId)) || !available()) return refusal();
    live = d.registry.getLive(appSessionId);
    if (live?.summary.providerSessionId !== (historical.providerSessionId ?? appSessionId))
      return refusal();
  }
  const captured = live;
  const provider = live.session;
  const current = () =>
    available() &&
    d.registry.getLive(appSessionId) === captured &&
    captured.session === provider &&
    !captured.closeMode;
  if (isBusy(live, d)) return { status: 'busy', retryOn: 'target' };
  const settingsApplied = await d.applyPendingSessionSettings(appSessionId);
  if (!current()) return refusal();
  if (!settingsApplied)
    return { status: 'unavailable', error: 'Could not apply the target session settings.' };
  if (isBusy(live, d)) return { status: 'busy', retryOn: 'target' };
  return await dispatch(context, appSessionId, prompt, isCurrent, {
    isCurrent: () =>
      current() &&
      !captured.interrupting &&
      !captured.interruptingForSteer &&
      !d.hasActiveSettingsChanges(appSessionId),
  });
}

/** Starts the turn and waits for the runtime to take the prompt, or for the turn to end without it. */
async function dispatch(
  context: DeliveryContext,
  appSessionId: string,
  prompt: string,
  isCurrent: () => boolean,
  turn: Pick<ScheduledTurnDelivery, 'isCurrent'>,
): Promise<AutomationDeliveryReceipt> {
  let acknowledge: (outcome: 'accepted' | 'declined' | 'unknown') => void = () => undefined;
  const acknowledgement = new Promise<'accepted' | 'declined' | 'unknown'>((resolve) => {
    acknowledge = resolve;
  });
  // Reserve synchronously, then wait for the runtime, not async provider setup.
  const settled = context.start(appSessionId, prompt, {
    isCurrent: turn.isCurrent,
    accepted: () => {
      acknowledge('accepted');
    },
    declined: () => {
      acknowledge('declined');
    },
  });
  void settled.then(
    () => {
      acknowledge('unknown');
    },
    () => {
      acknowledge('unknown');
    },
  );
  const outcome = await acknowledgement;
  if (outcome === 'accepted') return { status: 'accepted', settled };
  if (outcome === 'declined' && !isCurrent()) return { status: 'cancelled' };
  return {
    status: 'unavailable',
    error: 'Delivery was not acknowledged; outcome unknown. Inspect conversation before retrying.',
  };
}

function isBusy(live: LiveSession, d: SessionLifecycleDependencies): boolean {
  return (
    live.streaming ||
    live.compacting === true ||
    live.autoCompacting ||
    live.closeMode !== undefined ||
    live.interrupting === true ||
    live.interruptingForSteer === true ||
    live.pendingSends.length > 0 ||
    d.hasPendingInteractions(live.summary.appSessionId) ||
    d.hasActiveSettingsChanges(live.summary.appSessionId) ||
    live.summary.phase === 'initializing' ||
    live.summary.phase === 'intake' ||
    live.summary.phase === 'awaiting_plan_approval' ||
    live.summary.phase === 'awaiting_run_start'
  );
}
