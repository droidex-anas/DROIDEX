import type { ChildSessionSummary, ContextStatsSnapshot, TranscriptEvent } from '@droidex/protocol';
import { releaseSessionChildTranscriptWindow } from '../lib/transcriptStoreMemory';
import type { TranscriptMutation } from '../lib/transcriptMutation';
import { INACTIVE_TRANSCRIPT_POLICY, VIEWPORT_TRANSCRIPT_POLICY } from '../lib/transcriptWindow';
import type { UtilityPanelState } from '../lib/utilityPanel';
import { lookupChild } from './storeLookup';

/* eslint-disable @typescript-eslint/no-dynamic-delete -- sparse childAccess parent keys */

export type ChildSessionInfo = ChildSessionSummary;

export interface ChildSelection {
  parentAppSessionId: string;
  childSessionId: string;
}

export type ChildAccess =
  | { state: 'opening'; requestId: string }
  | { state: 'ready'; requestId: string; runtimeGeneration: number }
  | { state: 'history'; requestId: string }
  | { state: 'failed'; requestId: string | null }
  | { state: 'closed'; requestId: null };

export interface ChildRuntimeState {
  available: boolean;
  runtimeGeneration: number;
}

export type SessionRestoreStatus = 'loading' | 'paged' | 'loaded' | 'failed';

export interface SessionRestore {
  status: SessionRestoreStatus;
  loadedCount: number;
  hasMore: boolean;
  error?: string;
}

export interface ChildHistoryState extends SessionRestore {
  isLoaded: boolean;
  isLoadingOlder: boolean;
  olderCursor?: string;
  isViewportPinned: boolean;
}

export type ChildSessionAction =
  | {
      type: 'CHILD_UPDATED';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string;
      access: 'ready';
      runtimeGeneration: number;
    }
  | {
      type: 'CHILD_UPDATED';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string;
      access: 'history';
    }
  | {
      type: 'CHILD_ERROR';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string | null;
      operation: 'open' | 'loadHistory' | 'send' | 'interrupt' | 'settings';
      message: string;
    }
  | { type: 'CHILD_HISTORY_LOADING'; parentAppSessionId: string; childSessionId: string }
  | { type: 'CHILD_HISTORY_LOADING_OLDER'; parentAppSessionId: string; childSessionId: string }
  | {
      type: 'CHILD_TRANSCRIPT_VIEWPORT';
      parentAppSessionId: string;
      childSessionId: string;
      pinned: boolean;
    }
  | {
      type: 'CHILD_TRANSCRIPT_RELEASE_VIEWPORT';
      parentAppSessionId: string;
      childSessionId: string;
    }
  | { type: 'SELECT_CHILD'; selection: ChildSelection | null; requestId?: string };

type ChildSessionActionOf<T extends ChildSessionAction['type']> = Extract<
  ChildSessionAction,
  { type: T }
>;

export interface ChildSessionStore {
  childAccess: Record<string, Record<string, ChildAccess>>;
  childRuntime: Record<string, Record<string, ChildRuntimeState>>;
  childHistory: Record<string, Record<string, ChildHistoryState>>;
  childSessions: Record<string, Record<string, ChildSessionInfo>>;
  // Chats with at least one agent working right now. Its own map so the sidebar
  // can read a chat's agent state without selecting the child sessions
  // themselves, whose entries are replaced on every activity preview and token
  // tick; only a crossing into or out of `running` rewrites this one.
  agentsWorkingByParent: Partial<Record<string, true>>;
  selectedChild: ChildSelection | null;
  activeAppSessionId: string | null;
  utilityPanels: Record<string, UtilityPanelState>;
  contextStats: {
    primary: Record<string, ContextStatsSnapshot>;
    child: Record<string, Record<string, ContextStatsSnapshot>>;
  };
  transcripts: Record<string, TranscriptEvent[]>;
  transcriptMutations: Record<string, TranscriptMutation>;
  transcriptRetainedCost: Record<string, number>;
  historyLoaded: Record<string, boolean>;
  historyCursor: Record<string, string | undefined>;
  historyLoadingOlder: Record<string, boolean>;
  sessionRestore: Partial<Record<string, SessionRestore>>;
}

function withChildAccess<S extends ChildSessionStore>(
  state: S,
  parentAppSessionId: string,
  childSessionId: string,
  access: ChildAccess,
): S {
  const parent = state.childAccess[parentAppSessionId] ?? {};
  return {
    ...state,
    childAccess: {
      ...state.childAccess,
      [parentAppSessionId]: { ...parent, [childSessionId]: access },
    },
  };
}

function withoutChildAccess<S extends ChildSessionStore>(
  state: S,
  parentAppSessionId: string,
  childSessionId: string,
): S {
  const parent = { ...(state.childAccess[parentAppSessionId] ?? {}) };
  delete parent[childSessionId];
  const childAccess = { ...state.childAccess };
  if (Object.keys(parent).length === 0) delete childAccess[parentAppSessionId];
  else childAccess[parentAppSessionId] = parent;
  return { ...state, childAccess };
}

function withChildRuntime<S extends ChildSessionStore>(
  state: S,
  parentAppSessionId: string,
  childSessionId: string,
  runtime: ChildRuntimeState,
): S {
  const parent = state.childRuntime[parentAppSessionId] ?? {};
  return {
    ...state,
    childRuntime: {
      ...state.childRuntime,
      [parentAppSessionId]: { ...parent, [childSessionId]: runtime },
    },
  };
}

export function withChildHistory<S extends ChildSessionStore>(
  state: S,
  parentAppSessionId: string,
  childSessionId: string,
  history: ChildHistoryState,
): S {
  return {
    ...state,
    childHistory: {
      ...state.childHistory,
      [parentAppSessionId]: {
        ...state.childHistory[parentAppSessionId],
        [childSessionId]: history,
      },
    },
  };
}

export function releaseInactiveChildTranscript<S extends ChildSessionStore>(
  state: S,
  parentAppSessionId: string,
  childSessionId: string,
): S {
  const panels: Partial<ChildSessionStore['utilityPanels']> = state.utilityPanels;
  const panel = panels[parentAppSessionId];
  const readingInPane =
    state.activeAppSessionId === parentAppSessionId &&
    panel?.open &&
    panel.tabs.some(
      (tab) =>
        tab.id === panel.activeTabId && tab.tool === 'agents' && tab.agentId === childSessionId,
    );
  if (readingInPane) return state;
  const history = lookupChild(state.childHistory, parentAppSessionId, childSessionId);
  if (history && (!history.isLoaded || !history.isViewportPinned)) return state;
  const child = lookupChild(state.childSessions, parentAppSessionId, childSessionId);
  const runtime = lookupChild(state.childRuntime, parentAppSessionId, childSessionId);
  if (child?.status === 'running' && runtime?.available) return state;
  return releaseSessionChildTranscriptWindow(
    state,
    parentAppSessionId,
    childSessionId,
    INACTIVE_TRANSCRIPT_POLICY,
  );
}

export function releaseInactiveSelectedChild<S extends ChildSessionStore>(state: S): S {
  const selected = state.selectedChild;
  return selected
    ? releaseInactiveChildTranscript(state, selected.parentAppSessionId, selected.childSessionId)
    : state;
}

export function invalidateSelectedChildOpening<S extends ChildSessionStore>(state: S): S {
  const selected = state.selectedChild;
  if (!selected) return state;
  const access = lookupChild(
    state.childAccess,
    selected.parentAppSessionId,
    selected.childSessionId,
  );
  return access?.state === 'opening'
    ? withChildAccess(state, selected.parentAppSessionId, selected.childSessionId, {
        state: 'closed',
        requestId: null,
      })
    : state;
}

export function reduceChildSession<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionAction,
): S {
  switch (action.type) {
    case 'CHILD_UPDATED':
      return reduceChildUpdated(state, action);
    case 'CHILD_ERROR':
      return reduceChildError(state, action);
    case 'CHILD_HISTORY_LOADING':
      return reduceChildHistoryLoading(state, action);
    case 'CHILD_HISTORY_LOADING_OLDER':
      return reduceChildHistoryLoadingOlder(state, action);
    case 'CHILD_TRANSCRIPT_VIEWPORT':
      return reduceChildTranscriptViewport(state, action);
    case 'CHILD_TRANSCRIPT_RELEASE_VIEWPORT':
      return reduceChildTranscriptReleaseViewport(state, action);
    case 'SELECT_CHILD':
      return reduceSelectChild(state, action);
  }
}

function reduceChildUpdated<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'CHILD_UPDATED'>,
): S {
  if (
    state.selectedChild?.parentAppSessionId !== action.parentAppSessionId ||
    state.selectedChild.childSessionId !== action.childSessionId
  )
    return state;
  const current = lookupChild(state.childAccess, action.parentAppSessionId, action.childSessionId);
  if (current?.state !== 'opening' || current.requestId !== action.requestId) return state;
  const runtime = lookupChild(state.childRuntime, action.parentAppSessionId, action.childSessionId);
  if (
    action.access === 'ready' &&
    runtime &&
    (action.runtimeGeneration < runtime.runtimeGeneration ||
      (action.runtimeGeneration === runtime.runtimeGeneration && !runtime.available))
  )
    return state;
  const settled = withChildAccess(
    state,
    action.parentAppSessionId,
    action.childSessionId,
    action.access === 'ready'
      ? {
          state: 'ready',
          requestId: action.requestId,
          runtimeGeneration: action.runtimeGeneration,
        }
      : { state: 'history', requestId: action.requestId },
  );
  return action.access === 'ready'
    ? withChildRuntime(settled, action.parentAppSessionId, action.childSessionId, {
        available: true,
        runtimeGeneration: action.runtimeGeneration,
      })
    : settled;
}

function reduceChildError<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'CHILD_ERROR'>,
): S {
  if (action.operation === 'loadHistory') {
    const previous = lookupChild(
      state.childHistory,
      action.parentAppSessionId,
      action.childSessionId,
    );
    const next = withChildHistory(state, action.parentAppSessionId, action.childSessionId, {
      status: 'failed',
      loadedCount: previous?.loadedCount ?? 0,
      hasMore: previous?.hasMore ?? false,
      error: action.message,
      isLoaded: previous?.isLoaded ?? false,
      isLoadingOlder: false,
      olderCursor: previous?.olderCursor,
      isViewportPinned: previous?.isViewportPinned ?? true,
    });
    return next;
  }
  if (action.operation !== 'open' || !action.requestId) return state;
  if (
    state.selectedChild?.parentAppSessionId !== action.parentAppSessionId ||
    state.selectedChild.childSessionId !== action.childSessionId
  )
    return state;
  const current = lookupChild(state.childAccess, action.parentAppSessionId, action.childSessionId);
  if (current?.state !== 'opening' || current.requestId !== action.requestId) return state;
  return withChildAccess(state, action.parentAppSessionId, action.childSessionId, {
    state: 'failed',
    requestId: action.requestId,
  });
}

function reduceChildHistoryLoading<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'CHILD_HISTORY_LOADING'>,
): S {
  const previous = lookupChild(
    state.childHistory,
    action.parentAppSessionId,
    action.childSessionId,
  );
  return withChildHistory(state, action.parentAppSessionId, action.childSessionId, {
    status: 'loading',
    loadedCount: previous?.loadedCount ?? 0,
    hasMore: previous?.hasMore ?? false,
    isLoaded: false,
    isLoadingOlder: false,
    olderCursor: undefined,
    isViewportPinned: previous?.isViewportPinned ?? true,
  });
}

function reduceChildHistoryLoadingOlder<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'CHILD_HISTORY_LOADING_OLDER'>,
): S {
  const previous = lookupChild(
    state.childHistory,
    action.parentAppSessionId,
    action.childSessionId,
  );
  if (!previous || previous.isLoadingOlder) return state;
  return withChildHistory(state, action.parentAppSessionId, action.childSessionId, {
    ...previous,
    isLoadingOlder: true,
  });
}

function reduceChildTranscriptViewport<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'CHILD_TRANSCRIPT_VIEWPORT'>,
): S {
  const previous = lookupChild(
    state.childHistory,
    action.parentAppSessionId,
    action.childSessionId,
  );
  if (!previous || previous.isViewportPinned === action.pinned) return state;
  return {
    ...state,
    childHistory: {
      ...state.childHistory,
      [action.parentAppSessionId]: {
        ...state.childHistory[action.parentAppSessionId],
        [action.childSessionId]: {
          ...previous,
          isViewportPinned: action.pinned,
        },
      },
    },
  };
}

function reduceChildTranscriptReleaseViewport<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'CHILD_TRANSCRIPT_RELEASE_VIEWPORT'>,
): S {
  if (
    state.activeAppSessionId !== action.parentAppSessionId ||
    state.selectedChild?.parentAppSessionId !== action.parentAppSessionId ||
    state.selectedChild.childSessionId !== action.childSessionId
  ) {
    return state;
  }
  const history = lookupChild(state.childHistory, action.parentAppSessionId, action.childSessionId);
  if (!history?.isLoaded || !history.isViewportPinned) return state;
  const child = lookupChild(state.childSessions, action.parentAppSessionId, action.childSessionId);
  const runtime = lookupChild(state.childRuntime, action.parentAppSessionId, action.childSessionId);
  if (child?.status === 'running' && runtime?.available) return state;
  return releaseSessionChildTranscriptWindow(
    state,
    action.parentAppSessionId,
    action.childSessionId,
    VIEWPORT_TRANSCRIPT_POLICY,
  );
}

function reduceSelectChild<S extends ChildSessionStore>(
  state: S,
  action: ChildSessionActionOf<'SELECT_CHILD'>,
): S {
  const previous = state.selectedChild;
  let next =
    previous &&
    (action.selection?.parentAppSessionId !== previous.parentAppSessionId ||
      action.selection.childSessionId !== previous.childSessionId)
      ? invalidateSelectedChildOpening(releaseInactiveSelectedChild(state))
      : state;
  if (!action.selection) return { ...next, selectedChild: null };
  const { parentAppSessionId, childSessionId } = action.selection;
  if (
    next.activeAppSessionId !== parentAppSessionId ||
    !lookupChild(next.childSessions, parentAppSessionId, childSessionId)
  )
    return { ...next, selectedChild: null };
  next = { ...next, selectedChild: action.selection };
  if (action.requestId) {
    const opening = withChildAccess(next, parentAppSessionId, childSessionId, {
      state: 'opening',
      requestId: action.requestId,
    });
    const history = lookupChild(opening.childHistory, parentAppSessionId, childSessionId);
    if (history?.isLoaded) return opening;
    const loadedCount = (opening.transcripts[parentAppSessionId] ?? []).filter(
      (event) => event.sourceSessionId === childSessionId,
    ).length;
    return withChildHistory(opening, parentAppSessionId, childSessionId, {
      status: 'loading',
      loadedCount,
      hasMore: false,
      isLoaded: false,
      isLoadingOlder: false,
      isViewportPinned: history?.isViewportPinned ?? true,
    });
  }
  const access = lookupChild(next.childAccess, parentAppSessionId, childSessionId);
  return access?.state === 'failed' || access?.state === 'closed'
    ? withoutChildAccess(next, parentAppSessionId, childSessionId)
    : next;
}
