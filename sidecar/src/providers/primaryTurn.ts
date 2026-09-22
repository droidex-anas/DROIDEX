import { isDesignPrompt } from '../browser/designPromptPacks.js';
import type { ServerEvent, SessionSummary } from '../protocol.js';
import type { LiveOperationTarget, SessionContext } from '../SessionContext.js';
import type { SessionEventFlow } from '../SessionEventFlow.js';
import { errMsg, isUserCancellation } from '../sessionHelpers.js';
import type { ProviderMention } from './catalog.js';
import type { LiveSession } from '../SessionLifecycle.js';
import type { ScheduledTurnDelivery } from '../sessionAutomationDelivery.js';
import { isReportedStreamingTranscriptError, type SessionTimeline } from '../SessionTimeline.js';
import { usageLimitDetails } from './usageLimit.js';

export interface PrimaryTurnDependencies {
  eventFlow: Pick<SessionEventFlow, 'beginTurn' | 'apply'>;
  context: Pick<SessionContext, 'beginTurn' | 'startPolling' | 'stopPolling' | 'refresh'>;
  timeline: Pick<
    SessionTimeline,
    'recordPrompt' | 'settleStreaming' | 'appendStatus' | 'appendError'
  >;
  // Absent for a provider without Droid's context accounting.
  contextTarget: (liveSession: LiveSession) => LiveOperationTarget | undefined;
  isCurrent: (liveSession: LiveSession) => boolean;
  // False when the policy could not be applied, which cancels a scheduled
  // delivery rather than sending it into a session configured for something else.
  applyDesignToolPolicy: (liveSession: LiveSession, design: boolean) => Promise<boolean>;
  updateSummary: (appSessionId: string, patch: Partial<SessionSummary>) => void;
  emitError: (error: Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>) => void;
}

export interface PrimaryTurnRequest {
  prompt: string;
  mentions?: ProviderMention[];
  delivery?: ScheduledTurnDelivery;
  // Set when the app, not the user, started this turn. The transcript then gets
  // this quiet status row instead of a prompt bubble nobody typed.
  notice?: string;
}

export async function runPrimaryTurn(
  d: PrimaryTurnDependencies,
  liveSession: LiveSession,
  request: PrimaryTurnRequest,
): Promise<void> {
  const { prompt, mentions, delivery, notice } = request;
  const appSessionId = liveSession.summary.appSessionId;
  const context = turnContext(d, d.contextTarget(liveSession));
  if (!d.isCurrent(liveSession)) return;
  // A scheduled delivery that cannot go ahead must leave no trace, and
  // recordPrompt below writes to the durable transcript. So its preflight runs
  // before the turn is opened; an interactive turn keeps its existing order.
  const preflight = delivery
    ? await d.applyDesignToolPolicy(liveSession, isDesignPrompt(prompt))
    : undefined;
  if (delivery && (!d.isCurrent(liveSession) || !preflight || !delivery.isCurrent())) return;
  d.eventFlow.beginTurn(appSessionId, appSessionId);
  if (notice) d.timeline.appendStatus(appSessionId, notice);
  else d.timeline.recordPrompt(appSessionId, prompt);
  d.context.beginTurn(appSessionId);
  context.startPolling();
  let turnError: unknown;
  let reportedError = false;
  let reportedUsageLimit = false;
  try {
    const configured =
      preflight ?? (await d.applyDesignToolPolicy(liveSession, isDesignPrompt(prompt)));
    if (!d.isCurrent(liveSession) || (delivery && (!configured || !delivery.isCurrent()))) {
      context.stopPolling();
      return;
    }
    for await (const normalized of liveSession.session.stream(prompt, mentions)) {
      // The runtime answered, so the prompt is accepted even if this turn stops
      // applying events; acknowledgement must never depend on the turn's outcome.
      delivery?.accepted();
      if (!d.isCurrent(liveSession)) break;
      d.eventFlow.apply(appSessionId, appSessionId, 'primary', normalized);
      if (normalized.transcript?.kind === 'error') {
        reportedError = true;
        reportedUsageLimit ||= normalized.transcript.errorKind === 'usage_limit';
      }
    }
    // A stream that ends without a single event still ran to completion.
    delivery?.accepted();
  } catch (err) {
    turnError = err;
  }
  try {
    // Deliver any buffered streaming tail before the turn reads as settled.
    d.timeline.settleStreaming(appSessionId, appSessionId);
  } catch (err) {
    turnError ??= err;
  } finally {
    context.stopPolling();
  }
  if (!d.isCurrent(liveSession)) return;
  if (turnError) settleTurnFailure(d, liveSession, turnError, reportedError, reportedUsageLimit);
  // Keep streaming=true while the context refresh is in flight so concurrent
  // sends queue instead of racing a second lifecycle turn.
  await context.refresh();
}

function settleTurnFailure(
  d: PrimaryTurnDependencies,
  liveSession: LiveSession,
  error: unknown,
  reportedError: boolean,
  reportedUsageLimit: boolean,
): void {
  const appSessionId = liveSession.summary.appSessionId;
  if (liveSession.interruptingForSteer && isUserCancellation(error)) {
    d.timeline.appendStatus(appSessionId, 'Current turn interrupted for steering.');
    return;
  }
  if (liveSession.interrupting && isUserCancellation(error)) {
    // Stop already set the paused phase; its cancellation is not a failure.
    d.updateSummary(appSessionId, { phase: 'paused' });
    return;
  }
  if (!isReportedStreamingTranscriptError(error)) {
    const message = errMsg(error);
    const usageLimit = usageLimitDetails(error);
    if (!reportedError || (usageLimit.errorKind && !reportedUsageLimit)) {
      d.timeline.appendError(appSessionId, message, usageLimit);
    }
    d.emitError({ appSessionId, message });
  }
  d.updateSummary(appSessionId, { phase: 'failed' });
}

interface TurnContext {
  startPolling(): void;
  stopPolling(): void;
  refresh(): Promise<void>;
}

// Context accounting is Droid's own. A session on any other provider has no
// target, and the turn runs with every context call inert instead of carrying
// the provider question through its body.
function turnContext(
  d: PrimaryTurnDependencies,
  target: LiveOperationTarget | undefined,
): TurnContext {
  if (!target)
    return {
      startPolling: () => undefined,
      stopPolling: () => undefined,
      refresh: () => Promise.resolve(),
    };
  return {
    startPolling: () => {
      d.context.startPolling(target);
    },
    stopPolling: () => {
      d.context.stopPolling(target);
    },
    refresh: () => d.context.refresh(target),
  };
}
