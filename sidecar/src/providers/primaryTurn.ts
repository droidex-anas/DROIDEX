import { isDesignPrompt } from '../browser/designPromptPacks.js';
import type { ServerEvent, SessionSummary } from '../protocol.js';
import type { LiveOperationTarget, SessionContext } from '../SessionContext.js';
import type { SessionEventFlow } from '../SessionEventFlow.js';
import { errMsg, isUserCancellation } from '../errors.js';
import type { ProviderMention } from './catalog.js';
import type { LiveSession } from '../SessionLifecycle.js';
import type { ScheduledTurnDelivery } from '../sessionAutomationDelivery.js';
import { isReportedStreamingTranscriptError, type SessionTimeline } from '../SessionTimeline.js';
import { UsageLimitError, usageLimitDetails } from './usageLimit.js';

export interface PrimaryTurnDependencies {
  eventFlow: Pick<SessionEventFlow, 'beginTurn' | 'apply'>;
  context: Pick<SessionContext, 'beginTurn' | 'startPolling' | 'stopPolling' | 'refresh'>;
  timeline: Pick<
    SessionTimeline,
    'recordPrompt' | 'announcePrompt' | 'settleStreaming' | 'appendStatus' | 'appendError'
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
  // Set for a prompt the chat has not drawn as a row: one nobody typed (a
  // scheduled delivery, a message from another chat), or a steer that runs as
  // a turn of its own, which the chat showed only as pending. The turn adds
  // the row itself.
  announce?: true;
  // A message from another chat stops here once its sender may no longer send
  // it, even after the transcript row is written.
  stillAllowed?: () => boolean;
}

export async function runPrimaryTurn(
  d: PrimaryTurnDependencies,
  liveSession: LiveSession,
  request: PrimaryTurnRequest,
): Promise<void> {
  const { prompt, mentions, delivery, notice, announce, stillAllowed } = request;
  const appSessionId = liveSession.summary.appSessionId;
  const providerSession = liveSession.session;
  const isCurrent = () =>
    d.isCurrent(liveSession) &&
    liveSession.session === providerSession &&
    (stillAllowed?.() ?? true);
  // A Stop that lands before the provider has a turn to interrupt. A Send now
  // in the same window is left alone: its prompt is queued behind this one,
  // and the agent needs this one to make sense of it.
  const stoppedBeforeStart = () => liveSession.interrupting === true;
  // Counts the turns the provider started itself, so this one's failure cannot
  // be written over one that ran after it.
  const delegatedTurns = liveSession.delegatedTurns;
  const context = turnContext(d, d.contextTarget(liveSession));
  if (!isCurrent()) return;
  // A scheduled delivery that cannot go ahead must leave no trace, and
  // recordPrompt below writes to the durable transcript. So its preflight runs
  // before the turn is opened; an interactive turn keeps its existing order.
  const preflight = delivery
    ? await d.applyDesignToolPolicy(liveSession, isDesignPrompt(prompt))
    : undefined;
  if (delivery && (!isCurrent() || !preflight || !delivery.isCurrent())) {
    delivery.declined(isCurrent() && delivery.isCurrent() ? 'failed' : 'stale');
    return;
  }
  d.eventFlow.beginTurn(appSessionId, appSessionId);
  if (notice) d.timeline.appendStatus(appSessionId, notice);
  else {
    const writing = announce
      ? d.timeline.announcePrompt(appSessionId, prompt)
      : d.timeline.recordPrompt(appSessionId, prompt);
    if (writing) await writing;
  }
  if (!isCurrent() || stoppedBeforeStart()) {
    delivery?.declined('stale');
    return;
  }
  d.context.beginTurn(appSessionId);
  context.startPolling();
  let turnError: unknown;
  let reportedError = false;
  let reportedUsageLimit = false;
  try {
    const configured =
      preflight ?? (await d.applyDesignToolPolicy(liveSession, isDesignPrompt(prompt)));
    if (
      !isCurrent() ||
      stoppedBeforeStart() ||
      (delivery && (!configured || !delivery.isCurrent()))
    ) {
      delivery?.declined('stale');
      context.stopPolling();
      return;
    }
    for await (const normalized of providerSession.stream(prompt, mentions)) {
      // The runtime answered, so the prompt is accepted even if this turn stops
      // applying events; acknowledgement must never depend on the turn's outcome.
      delivery?.accepted();
      if (!isCurrent()) break;
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
    if (isCurrent()) await d.timeline.settleStreaming(appSessionId, appSessionId);
  } catch (err) {
    turnError ??= err;
  } finally {
    context.stopPolling();
  }
  if (!isCurrent()) return;
  // A turn the provider started itself after this one owns the outcome now:
  // its failure or its limit is newer than anything this turn could report.
  const superseded = liveSession.delegatedTurns !== delegatedTurns;
  if (turnError) {
    if (!superseded)
      settleTurnFailure(d, liveSession, turnError, reportedError, reportedUsageLimit);
  }
  // An answered turn is the only evidence that a limit has lifted; a stopped
  // one proves nothing.
  else if (
    !superseded &&
    liveSession.summary.usageLimit &&
    !liveSession.interrupting &&
    !liveSession.interruptingToSend
  )
    d.updateSummary(appSessionId, { usageLimit: undefined });
  // Not awaited: Droid can take long to answer, and the chat would read as
  // busy meanwhile, holding back what is queued for it. A newer turn's
  // refresh supersedes this one (SessionContext).
  void context.refresh();
}

function settleTurnFailure(
  d: PrimaryTurnDependencies,
  liveSession: LiveSession,
  error: unknown,
  reportedError: boolean,
  reportedUsageLimit: boolean,
): void {
  const appSessionId = liveSession.summary.appSessionId;
  if (liveSession.interruptingToSend && isUserCancellation(error)) {
    d.timeline.appendStatus(appSessionId, 'Turn stopped to send now.');
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
  d.updateSummary(appSessionId, failedTurnSummary(error));
}

// The limit is set only by a refusal. A failure of any other kind says nothing
// about it, so a hold already set stays until a turn gets an answer.
export function failedTurnSummary(error: unknown): Pick<SessionSummary, 'phase' | 'usageLimit'> {
  return {
    phase: 'failed',
    ...(error instanceof UsageLimitError ? { usageLimit: error.limit } : {}),
  };
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
