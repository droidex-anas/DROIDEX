import { randomUUID } from 'node:crypto';

import { isDesignPrompt } from '../browser/designPromptPacks.js';
import type { ServerEvent, SessionSummary } from '../protocol.js';
import type { LiveOperationTarget, SessionContext } from '../SessionContext.js';
import type { SessionEventFlow } from '../SessionEventFlow.js';
import { errMsg, isUserCancellation } from '../sessionHelpers.js';
import type { LiveSession } from '../SessionLifecycle.js';
import { isReportedStreamingTranscriptError, type SessionTimeline } from '../SessionTimeline.js';

export interface PrimaryTurnDependencies {
  eventFlow: Pick<SessionEventFlow, 'beginTurn' | 'apply'>;
  context: Pick<SessionContext, 'beginTurn' | 'startPolling' | 'stopPolling' | 'refresh'>;
  timeline: Pick<SessionTimeline, 'recordPrompt' | 'settleStreaming' | 'appendStatus' | 'append'>;
  // Absent for a provider without Droid's context accounting.
  contextTarget: (liveSession: LiveSession) => LiveOperationTarget | undefined;
  isCurrent: (liveSession: LiveSession) => boolean;
  applyDesignToolPolicy: (liveSession: LiveSession, design: boolean) => Promise<void>;
  updateSummary: (appSessionId: string, patch: Partial<SessionSummary>) => void;
  emitError: (error: Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>) => void;
}

export async function runPrimaryTurn(
  d: PrimaryTurnDependencies,
  liveSession: LiveSession,
  prompt: string,
): Promise<void> {
  const appSessionId = liveSession.summary.appSessionId;
  const context = turnContext(d, d.contextTarget(liveSession));
  if (!d.isCurrent(liveSession)) return;
  d.eventFlow.beginTurn(appSessionId, appSessionId);
  d.timeline.recordPrompt(appSessionId, prompt);
  d.context.beginTurn(appSessionId);
  context.startPolling();
  let turnError: unknown;
  let reportedError = false;
  try {
    await d.applyDesignToolPolicy(liveSession, isDesignPrompt(prompt));
    if (!d.isCurrent(liveSession)) {
      context.stopPolling();
      return;
    }
    for await (const normalized of liveSession.session.stream(prompt)) {
      if (!d.isCurrent(liveSession)) break;
      d.eventFlow.apply(appSessionId, appSessionId, 'primary', normalized);
      if (normalized.transcript?.kind === 'error') reportedError = true;
    }
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
  if (turnError) settleTurnFailure(d, liveSession, turnError, reportedError);
  // Keep streaming=true while the context refresh is in flight so concurrent
  // sends queue instead of racing a second lifecycle turn.
  await context.refresh();
}

function settleTurnFailure(
  d: PrimaryTurnDependencies,
  liveSession: LiveSession,
  error: unknown,
  reportedError: boolean,
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
    if (!reportedError) {
      d.timeline.append({
        id: randomUUID(),
        appSessionId,
        sourceSessionId: appSessionId,
        role: 'primary',
        ts: Date.now(),
        kind: 'error',
        text: message,
        isError: true,
      });
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
