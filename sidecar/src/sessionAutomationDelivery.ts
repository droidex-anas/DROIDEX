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
}

/** Acceptance requires a runtime stream response, not merely a reserved turn. */
export async function deliverScheduledMessage(
  context: DeliveryContext,
  appSessionId: string,
  prompt: string,
  isCurrent: () => boolean,
): Promise<AutomationDeliveryReceipt> {
  const d = context.dependencies;
  const unavailable = {
    status: 'unavailable',
    error: 'The scheduled target session is unavailable.',
  } satisfies AutomationDeliveryReceipt;
  const available = () => isCurrent() && !d.isShutdownStarted();
  const historical = d.registry.getCanonicalSummary(appSessionId);
  if (historical?.appSessionId !== appSessionId || !available()) return unavailable;
  let live = d.registry.getLive(appSessionId);
  if (!live) {
    if (!context.canResume()) return { status: 'busy' };
    if (!(await context.resume(appSessionId))) return unavailable;
    if (!available()) return unavailable;
    live = d.registry.getLive(appSessionId);
    if (live?.summary.providerSessionId !== (historical.providerSessionId ?? appSessionId))
      return unavailable;
  }
  const captured = live;
  const provider = live.session;
  const current = () =>
    available() &&
    d.registry.getLive(appSessionId) === captured &&
    captured.session === provider &&
    !captured.closeMode;
  if (isBusy(live, d)) return { status: 'busy' };
  const settingsApplied = await d.applyPendingSessionSettings(appSessionId);
  if (!current()) return unavailable;
  if (!settingsApplied)
    return { status: 'unavailable', error: 'Could not apply the target session settings.' };
  if (isBusy(live, d)) return { status: 'busy' };
  let acknowledge: (accepted: boolean) => void = () => undefined;
  const acknowledgement = new Promise<boolean>((resolve) => {
    acknowledge = resolve;
  });
  // Reserve synchronously, then wait for the runtime, not async provider setup.
  const settled = context.start(appSessionId, prompt, {
    isCurrent: () =>
      current() &&
      !captured.interrupting &&
      !captured.interruptingForSteer &&
      !d.hasActiveSettingsChanges(appSessionId),
    accepted: () => {
      acknowledge(true);
    },
  });
  void settled.then(
    () => {
      acknowledge(false);
    },
    () => {
      acknowledge(false);
    },
  );
  if (!(await acknowledgement)) {
    return {
      status: 'unavailable',
      error:
        'Delivery was not acknowledged; outcome unknown. Inspect conversation before retrying.',
    };
  }
  return { status: 'accepted', settled };
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
