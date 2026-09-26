import type { ChildSessionSummary } from '../types/bridge';
import {
  aggregateTranscriptMutationBatch,
  observeTranscriptMutationChanges,
  type TranscriptMutation,
} from '../lib/transcriptMutation';
import { isWorkingAgent } from '../lib/childSessions';
import { releaseInactiveChildTranscript, type ChildSessionStore } from './storeChildSession';

/* eslint-disable @typescript-eslint/no-unnecessary-condition -- keyed child records are sparse despite their Record types */
/* eslint-disable @typescript-eslint/no-dynamic-delete -- remove invalidated child context and settled parent flags */

interface ChildUpdate {
  child: ChildSessionSummary;
  runtimeAvailable: boolean;
  runtimeGeneration: number;
}

// Copies are owned by this synchronous run and never escape before it returns.
function writableParent<T>(
  original: Record<string, Record<string, T>>,
  current: Record<string, Record<string, T>>,
  parentId: string,
): Record<string, Record<string, T>> {
  const next = current === original ? { ...current } : current;
  if (next[parentId] === original[parentId]) next[parentId] = { ...next[parentId] };
  return next;
}

export function reduceSessionChildren<S extends ChildSessionStore>(
  state: S,
  actions: readonly ChildUpdate[],
): S {
  let next = state;
  const mutations = new Map<string, TranscriptMutation[]>();
  const workingParents = new Set<string>();
  for (const { child, runtimeAvailable, runtimeGeneration } of actions) {
    const { parentAppSessionId: parentId, childSessionId: childId } = child;
    const previousChild = next.childSessions[parentId]?.[childId];
    const previousRuntime = next.childRuntime[parentId]?.[childId];
    if (previousRuntime && runtimeGeneration < previousRuntime.runtimeGeneration) continue;
    const settledWhileInactive =
      previousChild?.status === 'running' &&
      previousRuntime?.available &&
      (child.status !== 'running' || !runtimeAvailable) &&
      (next.activeAppSessionId !== parentId ||
        next.selectedChild?.parentAppSessionId !== parentId ||
        next.selectedChild.childSessionId !== childId);
    if (next === state) next = { ...state };
    next.childSessions = writableParent(state.childSessions, next.childSessions, parentId);
    next.childSessions[parentId][childId] = child;

    const clearContext =
      !runtimeAvailable ||
      (previousRuntime !== undefined && runtimeGeneration > previousRuntime.runtimeGeneration);
    if (clearContext) {
      if (next.contextStats === state.contextStats) next.contextStats = { ...next.contextStats };
      next.contextStats.child = writableParent(
        state.contextStats.child,
        next.contextStats.child,
        parentId,
      );
      delete next.contextStats.child[parentId][childId];
    }
    if (
      previousRuntime?.runtimeGeneration !== runtimeGeneration ||
      previousRuntime.available !== runtimeAvailable
    ) {
      next.childRuntime = writableParent(state.childRuntime, next.childRuntime, parentId);
      next.childRuntime[parentId][childId] = { available: runtimeAvailable, runtimeGeneration };
      const access = next.childAccess[parentId]?.[childId];
      // Queued is waiting for a slot, not a finished open.
      if (
        !runtimeAvailable &&
        !child.queued &&
        (access?.state === 'opening' || access?.state === 'ready')
      ) {
        next.childAccess = writableParent(state.childAccess, next.childAccess, parentId);
        next.childAccess[parentId][childId] = { state: 'closed', requestId: null };
      } else if (runtimeAvailable && access?.state === 'ready') {
        next.childAccess = writableParent(state.childAccess, next.childAccess, parentId);
        next.childAccess[parentId][childId] = { ...access, runtimeGeneration };
      }
    }
    if (settledWhileInactive) {
      const released = releaseInactiveChildTranscript(next, parentId, childId);
      observeTranscriptMutationChanges(
        mutations,
        next.transcriptMutations,
        released.transcriptMutations,
      );
      next = released;
    }
    if (!previousChild || isWorkingAgent(previousChild, false) !== isWorkingAgent(child, false)) {
      workingParents.add(parentId);
    }
  }
  for (const parentId of workingParents) {
    const working = Object.values(next.childSessions[parentId]).some((child) =>
      isWorkingAgent(child, false),
    );
    if (working === (next.agentsWorkingByParent[parentId] ?? false)) continue;
    if (next.agentsWorkingByParent === state.agentsWorkingByParent) {
      next.agentsWorkingByParent = { ...next.agentsWorkingByParent };
    }
    if (working) next.agentsWorkingByParent[parentId] = true;
    else delete next.agentsWorkingByParent[parentId];
  }
  if (mutations.size > 0) {
    next.transcriptMutations = aggregateTranscriptMutationBatch(
      state.transcriptMutations,
      next.transcriptMutations,
      mutations,
    );
  }
  return next;
}
