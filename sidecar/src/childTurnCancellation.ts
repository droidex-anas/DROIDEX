import {
  setChildStatus,
  type ChildRuntimeState,
  type ChildSessionState,
  type ParentChildSessions,
} from './ChildSessionState.js';

export type PreparedChildInterrupt =
  | { kind: 'missing' }
  | { kind: 'queued'; parent: ParentChildSessions; child: ChildSessionState }
  | {
      kind: 'live';
      parent: ParentChildSessions;
      child: ChildSessionState;
      runtime: ChildRuntimeState;
    };

export function dequeueQueuedChild(parent: ParentChildSessions, child: ChildSessionState): void {
  parent.runtimeQueue = parent.runtimeQueue.filter((id) => id !== child.identity.childSessionId);
  if (!child.queued) return;
  child.queued = false;
  child.queuedRequestId = undefined;
}

export function cancelInFlightOpen(parent: ParentChildSessions, child: ChildSessionState): boolean {
  if (child.runtime) return false;
  const attempt = parent.openAttempts.get(child.identity.childSessionId);
  if (!attempt) return false;
  attempt.isCancelled = true;
  attempt.cancel();
  return true;
}

export function prepareChildInterrupt(
  parent: ParentChildSessions | undefined,
  child: ChildSessionState | undefined,
  now: number,
): PreparedChildInterrupt {
  if (!parent || !child) return { kind: 'missing' };
  child.turn.pendingSends = [];
  dequeueQueuedChild(parent, child);
  if (!child.runtime) cancelInFlightOpen(parent, child);
  const runtime = child.runtime;
  if (!runtime) {
    child.turn.interrupting = false;
    child.turn.phase = 'idle';
    if (child.status === 'running') setChildStatus(child, 'paused', now);
    return { kind: 'queued', parent, child };
  }
  return { kind: 'live', parent, child, runtime };
}
