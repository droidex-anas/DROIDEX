import { activeGrid, activeTab } from '../features/tabs/tabStrip';
import { gridTiles } from '../features/tabs/tileGrid';
import type { AppState } from '../hooks/useStore';

const EMPTY_TRANSCRIPT: never[] = [];

// The latest compose sent from this new chat that is still waiting for its
// session; `tileId` is null in a tab that is not split, which is its own tile.
function startingCompose(current: AppState, tileId: string | null) {
  const tab = activeTab(current.tabStrip);
  if (!tab) return undefined;
  const shownTileId = tileId ?? tab.tileId;
  return Object.values(current.pendingCompose)
    .filter((compose) => {
      const origin = compose?.origin;
      return origin?.tabId === tab.id && origin.tileId === shownTileId;
    })
    .at(-1);
}

// The live draft belongs to the focused tile; any other new-chat tile keeps
// its own in the tab's grid.
function shownDraft(current: AppState, tileId: string | null): AppState['draftChat'] {
  const grid = activeGrid(current.tabStrip);
  if (!tileId || !grid || grid.focusedTileId === tileId) return current.draftChat;
  const page = gridTiles(grid).find((tile) => tile.id === tileId)?.page;
  return page?.kind === 'new-chat' ? page.draft : null;
}

/** What a new chat starts, which its home shows around the composer. */
export type NewChatStart =
  | { kind: 'chat' }
  | { kind: 'design'; canvasId: string | null }
  | { kind: 'project' };

export function newChatStart(draft: AppState['draftChat']): NewChatStart {
  if (draft?.project) return { kind: 'project' };
  if (draft?.canvas) return { kind: 'design', canvasId: draft.canvas.canvasId };
  return { kind: 'chat' };
}

/**
 * The new-chat home: a page with no chat yet and no send on its way, which
 * centres its composer. Null once there is a chat or a send to show.
 */
export function selectNewChatHome(
  current: AppState,
  appSessionId: string | null,
  tileId: string | null,
): NewChatStart | null {
  const session = appSessionId ? current.sessions[appSessionId] : undefined;
  if (session || startingCompose(current, tileId)) return null;
  return newChatStart(shownDraft(current, tileId));
}

export function equalNewChatHome(left: NewChatStart | null, right: NewChatStart | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind === 'design' && right.kind === 'design') return left.canvasId === right.canvasId;
  return left.kind === right.kind;
}

export function selectChatViewState(
  current: AppState,
  appSessionId: string | null,
  tileId: string | null,
) {
  const activeSession = appSessionId ? (current.sessions[appSessionId] ?? null) : null;
  return {
    activeSession,
    allTranscript: activeSession
      ? (current.transcripts[activeSession.appSessionId] ?? EMPTY_TRANSCRIPT)
      : EMPTY_TRANSCRIPT,
    transcriptMutation: activeSession
      ? current.transcriptMutations[activeSession.appSessionId]
      : undefined,
    chatMetadata: current.chatMetadata,
    childAccess: current.childAccess,
    childHistory: current.childHistory,
    childSessions: current.childSessions,
    draftChat: shownDraft(current, tileId),
    historyCursor: current.historyCursor,
    historyLoadingOlder: current.historyLoadingOlder,
    models: current.models,
    startingCompose: activeSession ? undefined : startingCompose(current, tileId),
    selectedChild: current.selectedChild,
    sessionRestore: current.sessionRestore,
    sessionSpecs: current.sessionSpecs,
    specPlans: current.specPlans,
    transcriptRetainedCost: current.transcriptRetainedCost,
  };
}

export type ChatViewState = ReturnType<typeof selectChatViewState>;

function equalActiveChatSession(
  previous: ChatViewState['activeSession'],
  next: ChatViewState['activeSession'],
): boolean {
  return (
    previous === next ||
    (previous?.appSessionId === next?.appSessionId &&
      previous?.createdAt === next?.createdAt &&
      previous?.cwd === next?.cwd &&
      previous?.interactionMode === next?.interactionMode &&
      previous?.title === next?.title &&
      previous?.interruptReason === next?.interruptReason)
  );
}

function equalChildSelection(
  previous: AppState['selectedChild'],
  next: AppState['selectedChild'],
): boolean {
  return (
    previous === next ||
    (previous?.parentAppSessionId === next?.parentAppSessionId &&
      previous?.childSessionId === next?.childSessionId)
  );
}

export function equalVisibleChatState(previous: ChatViewState, next: ChatViewState): boolean {
  if (!equalActiveChatSession(previous.activeSession, next.activeSession)) return false;
  if (!Object.is(previous.allTranscript, next.allTranscript)) return false;
  if (!Object.is(previous.transcriptMutation, next.transcriptMutation)) return false;
  if (!Object.is(previous.models, next.models)) return false;
  if (!equalChildSelection(previous.selectedChild, next.selectedChild)) return false;
  // The draft decides what the empty screen offers, a chat or a project.
  if (!Object.is(previous.draftChat, next.draftChat)) return false;

  const appSessionId = next.activeSession?.appSessionId;
  if (!appSessionId) {
    return Object.is(previous.startingCompose, next.startingCompose);
  }
  if (
    !Object.is(previous.chatMetadata[appSessionId], next.chatMetadata[appSessionId]) ||
    !Object.is(previous.childAccess[appSessionId], next.childAccess[appSessionId]) ||
    !Object.is(previous.childSessions[appSessionId], next.childSessions[appSessionId]) ||
    previous.historyCursor[appSessionId] !== next.historyCursor[appSessionId] ||
    previous.historyLoadingOlder[appSessionId] !== next.historyLoadingOlder[appSessionId] ||
    !Object.is(previous.sessionRestore[appSessionId], next.sessionRestore[appSessionId]) ||
    previous.sessionSpecs[appSessionId] !== next.sessionSpecs[appSessionId] ||
    !Object.is(previous.specPlans[appSessionId], next.specPlans[appSessionId]) ||
    previous.transcriptRetainedCost[appSessionId] !== next.transcriptRetainedCost[appSessionId]
  ) {
    return false;
  }

  const childSessionId =
    next.selectedChild?.parentAppSessionId === appSessionId
      ? next.selectedChild.childSessionId
      : undefined;
  const previousChildHistory: Partial<ChatViewState['childHistory']> = previous.childHistory;
  const nextChildHistory: Partial<ChatViewState['childHistory']> = next.childHistory;
  return (
    !childSessionId ||
    Object.is(
      previousChildHistory[appSessionId]?.[childSessionId],
      nextChildHistory[appSessionId]?.[childSessionId],
    )
  );
}
