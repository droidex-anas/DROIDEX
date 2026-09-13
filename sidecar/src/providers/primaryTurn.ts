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
  timeline: Pick<SessionTimeline, 'settleStreaming' | 'appendStatus'>;
  contextTarget: (liveSession: LiveSession) => LiveOperationTarget;
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
  const contextTarget = d.contextTarget(liveSession);
  if (!d.isCurrent(liveSession)) return;
  d.eventFlow.beginTurn(appSessionId, appSessionId);
  d.context.beginTurn(appSessionId);
  d.context.startPolling(contextTarget);
  let turnError: unknown;
  try {
    await d.applyDesignToolPolicy(liveSession, isDesignPrompt(prompt));
    if (!d.isCurrent(liveSession)) {
      d.context.stopPolling(contextTarget);
      return;
    }
    for await (const normalized of liveSession.session.stream(prompt)) {
      if (!d.isCurrent(liveSession)) break;
      d.eventFlow.apply(appSessionId, appSessionId, 'primary', normalized);
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
    d.context.stopPolling(contextTarget);
  }
  if (!d.isCurrent(liveSession)) return;
  if (turnError) {
    if (liveSession.interruptingForSteer) {
      d.timeline.appendStatus(appSessionId, 'Current turn interrupted for steering.');
    } else if (liveSession.interrupting && isUserCancellation(turnError)) {
      // The user pressed Stop; interrupt() already set the paused phase, so
      // settle quietly without surfacing an error.
      d.updateSummary(appSessionId, { phase: 'paused' });
    } else {
      if (!isReportedStreamingTranscriptError(turnError)) {
        d.emitError({ appSessionId, message: errMsg(turnError) });
      }
      d.updateSummary(appSessionId, { phase: 'failed' });
    }
  }
  // Keep streaming=true while the context refresh is in flight so concurrent
  // sends queue instead of racing a second lifecycle turn.
  await d.context.refresh(contextTarget);
}
