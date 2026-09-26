import type { TranscriptEvent } from '../types/bridge';
import { appendTranscriptEvents } from '../lib/transcriptStoreMemory';
import {
  aggregateTranscriptMutationBatch,
  observeTranscriptMutationChanges,
  type TranscriptMutation,
} from '../lib/transcriptMutation';
import type { Action, AppState } from './useStore';
import { reduceSessionChildren } from './storeSessionChildren';

export function reduceStoreActionBatch(
  state: AppState,
  actions: readonly Action[],
  reduceAction: (state: AppState, action: Action) => AppState,
  syncBrowserState: (state: AppState) => AppState,
): AppState {
  let next = state;
  let pendingTranscriptEvents: TranscriptEvent[] = [];
  let pendingChildren: Extract<Action, { type: 'SESSION_CHILD' }>[] = [];
  const mutationRecords = new Map<string, TranscriptMutation[]>();

  const apply = (updated: AppState): void => {
    observeTranscriptMutationChanges(
      mutationRecords,
      next.transcriptMutations,
      updated.transcriptMutations,
    );
    next = updated;
  };

  const flushTranscriptEvents = (): void => {
    if (pendingTranscriptEvents.length === 0) return;
    apply(syncBrowserState(appendTranscriptEvents(next, pendingTranscriptEvents)));
    pendingTranscriptEvents = [];
  };

  const flushChildren = (): void => {
    if (pendingChildren.length === 0) return;
    apply(syncBrowserState(reduceSessionChildren(next, pendingChildren)));
    pendingChildren = [];
  };

  for (const action of actions) {
    if (action.type === 'SESSION_TRANSCRIPT') {
      flushChildren();
      pendingTranscriptEvents.push(action.event);
      continue;
    }
    flushTranscriptEvents();
    if (action.type === 'SESSION_CHILD') {
      pendingChildren.push(action);
      continue;
    }
    flushChildren();
    apply(reduceAction(next, action));
  }
  flushTranscriptEvents();
  flushChildren();

  const transcriptMutations = aggregateTranscriptMutationBatch(
    state.transcriptMutations,
    next.transcriptMutations,
    mutationRecords,
  );
  return transcriptMutations === next.transcriptMutations ? next : { ...next, transcriptMutations };
}
