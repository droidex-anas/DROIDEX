import type { SessionSummary, TranscriptEvent } from '@droidex/protocol';
import { placeCreatedChat } from '../features/tabs/tabNavigation';
import { markDesignChat } from '../lib/chatMetadata';
import { isSideChat, settleSideChatStart } from '../lib/sideChats';
import { appendTranscriptEvent, withUpdatedTranscript } from '../lib/transcriptStoreMemory';
import { estimateTranscriptCost } from '../lib/transcriptWindow';
import { invalidateSelectedChildOpening } from './storeChildSession';
import { withoutKey } from '../lib/records';
import type { Action, AppState, CanvasChatRequest } from './useStore';

/**
 * Tells one pane-opening request which chat its create made. Only that
 * request's entry moves; every other one keeps waiting for its own reply.
 */
function namedCanvasChatRequest(
  requests: Record<string, CanvasChatRequest>,
  clientRef: string,
  appSessionId: string,
): Record<string, CanvasChatRequest> {
  if (!(clientRef in requests)) return requests;
  const request = requests[clientRef];
  if (request.appSessionId !== null) return requests;
  return { ...requests, [clientRef]: { appSessionId } };
}

function createdChatMetadata(
  state: AppState,
  action: Extract<Action, { type: 'SESSION_CREATED' }>,
  ownsCreate: boolean,
): AppState['chatMetadata'] {
  // A design send's chat opens as a design from now on, in every window,
  // and is placed as one.
  return ownsCreate && action.clientRef in state.canvasChatRequests
    ? (markDesignChat(state.chatMetadata, action.session.appSessionId) ?? state.chatMetadata)
    : state.chatMetadata;
}

function createdSessionSeed(
  state: AppState,
  session: SessionSummary,
  pending: AppState['pendingCompose'][string],
): TranscriptEvent | undefined {
  // Seed the first user message: the goal is the user's opening prompt and the
  // backend never echoes it back, so without this the first message never shows.
  const transcripts: Partial<AppState['transcripts']> = state.transcripts;
  const hasTranscript = (transcripts[session.appSessionId]?.length ?? 0) > 0;
  if (session.goal && !hasTranscript) {
    return {
      id: `seed-${session.appSessionId}`,
      appSessionId: session.appSessionId,
      sourceSessionId: 'user',
      role: 'primary',
      ts: session.createdAt || Date.now(),
      kind: 'text',
      text: pending ? pending.text : session.goal,
      author: 'user',
      skills: pending?.skills.length ? pending.skills : undefined,
      // Only a compose owned by this renderer is live metadata. A seed from
      // another window or a resumed session is restored-equivalent content.
      files: pending?.files,
    };
  }
  return undefined;
}

function createdComposerSeeds(
  state: AppState,
  draftTileId: string | undefined,
  appSessionId: string,
): AppState['composerSeeds'] {
  // Seeds that arrived for the draft while it was sent go to the chat it became.
  return draftTileId
    ? state.composerSeeds.map((pendingSeed) =>
        pendingSeed.draftTileId === draftTileId
          ? { ...pendingSeed, appSessionId, draftTileId: null }
          : pendingSeed,
      )
    : state.composerSeeds;
}

function createdSessionFocus(
  state: AppState,
  appSessionId: string,
  shouldActivate: boolean,
  targetIsActive: boolean,
): Pick<
  AppState,
  | 'activeAppSessionId'
  | 'draftChat'
  | 'draftAutonomy'
  | 'draftFastMode'
  | 'draftContextWindowTokens'
  | 'selectedChild'
  | 'reviewFocusPath'
  | 'reviewFocusChange'
> {
  return {
    activeAppSessionId: shouldActivate ? appSessionId : state.activeAppSessionId,
    draftChat: shouldActivate ? null : state.draftChat,
    draftAutonomy: shouldActivate ? null : state.draftAutonomy,
    draftFastMode: shouldActivate ? false : state.draftFastMode,
    draftContextWindowTokens: shouldActivate ? null : state.draftContextWindowTokens,
    selectedChild: shouldActivate || targetIsActive ? null : state.selectedChild,
    // A pending review-focus request belongs to the session that issued
    // it; a different session becoming active must not inherit it.
    reviewFocusPath:
      shouldActivate && appSessionId !== state.activeAppSessionId ? null : state.reviewFocusPath,
    reviewFocusChange:
      shouldActivate && appSessionId !== state.activeAppSessionId ? null : state.reviewFocusChange,
  };
}

function createdSessionLastSeen(
  state: AppState,
  session: SessionSummary,
  shouldActivate: boolean,
): AppState['sessionLastSeen'] {
  // A foreground chat just created by this renderer is already seen. A
  // chat this client just learned of starts seen at its creation, so its
  // first reply reads as unread.
  return shouldActivate || !Object.hasOwn(state.sessionLastSeen, session.appSessionId)
    ? {
        ...state.sessionLastSeen,
        [session.appSessionId]: session.updatedAt,
      }
    : state.sessionLastSeen;
}

export function reduceSessionCreated(
  state: AppState,
  action: Extract<Action, { type: 'SESSION_CREATED' }>,
): AppState {
  const pending = state.pendingCompose[action.clientRef];
  // `session.created` is also emitted when an existing session resumes.
  // Only a create matching this renderer's pending compose may take focus;
  // background resumes must never replace the chat the user selected. A
  // side chat opens beside its source, never in its place. A create sent
  // from a tab or tile the user has since left opens there instead.
  const ownsCreate = pending !== undefined && !isSideChat(action.session);
  const sessions = { ...state.sessions, [action.session.appSessionId]: action.session };
  const chatMetadata = createdChatMetadata(state, action, ownsCreate);
  const placed = ownsCreate
    ? placeCreatedChat(
        { ...state, sessions, chatMetadata },
        pending.origin,
        action.session.appSessionId,
      )
    : null;
  const shouldActivate = placed?.focus === true;
  const tabStrip = placed?.tabStrip ?? state.tabStrip;
  const targetIsActive = state.activeAppSessionId === action.session.appSessionId;
  const childReset =
    shouldActivate || targetIsActive ? invalidateSelectedChildOpening(state) : state;
  const childAccess = { ...childReset.childAccess };
  const childRuntime = { ...childReset.childRuntime };
  delete childAccess[action.session.appSessionId];
  delete childRuntime[action.session.appSessionId];
  const order = state.sessionOrder.includes(action.session.appSessionId)
    ? state.sessionOrder
    : [action.session.appSessionId, ...state.sessionOrder];

  const seed = createdSessionSeed(state, action.session, pending);

  const pendingCompose = withoutKey(state.pendingCompose, action.clientRef);
  const draftTileId = ownsCreate ? pending.origin?.tileId : undefined;
  const composerSeeds = createdComposerSeeds(state, draftTileId, action.session.appSessionId);

  const next: AppState = {
    ...childReset,
    sessions,
    sessionOrder: order,
    tabStrip,
    ...createdSessionFocus(state, action.session.appSessionId, shouldActivate, targetIsActive),
    childAccess,
    childRuntime,
    pendingCompose,
    composerSeeds,
    pendingForks: withoutKey(state.pendingForks, action.clientRef),
    sideChats:
      state.pendingForks[action.clientRef]?.kind === 'side'
        ? settleSideChatStart(state.sideChats, action.clientRef, action.session.appSessionId)
        : state.sideChats,
    lastCreatedSessionRequest: shouldActivate
      ? { clientRef: action.clientRef, appSessionId: action.session.appSessionId }
      : state.lastCreatedSessionRequest,
    // This create's own pane request, if it had one, now knows the chat
    // it opens on. Another create in flight keeps its own target.
    canvasChatRequests: namedCanvasChatRequest(
      state.canvasChatRequests,
      action.clientRef,
      action.session.appSessionId,
    ),
    chatMetadata,
    sessionLastSeen: createdSessionLastSeen(state, action.session, shouldActivate),
  };
  return seed
    ? withUpdatedTranscript(
        next,
        action.session.appSessionId,
        [seed],
        estimateTranscriptCost([seed]),
        {
          mutation: { kind: 'append', previousLength: 0, firstChangedIndex: 0 },
        },
      )
    : next;
}

// A same-harness copy arrives stored and closed. It carries its source's
// transcript on disk; only a first message the sidecar is about to send
// needs seeding, since the backend never echoes it back.
export function reduceSessionForked(
  state: AppState,
  action: Extract<Action, { type: 'SESSION_FORKED' }>,
  reducer: (state: AppState, action: Action) => AppState,
): AppState {
  const pending = state.pendingForks[action.clientRef];
  const appSessionId = action.session.appSessionId;
  let next: AppState = {
    ...state,
    sessions: { ...state.sessions, [appSessionId]: action.session },
    sessionOrder: state.sessionOrder.includes(appSessionId)
      ? state.sessionOrder
      : [appSessionId, ...state.sessionOrder],
    pendingForks: withoutKey(state.pendingForks, action.clientRef),
    sideChats:
      pending?.kind === 'side'
        ? settleSideChatStart(state.sideChats, action.clientRef, appSessionId)
        : state.sideChats,
  };
  if (pending?.prompt) {
    const seed: TranscriptEvent = {
      id: `seed-${appSessionId}`,
      appSessionId,
      sourceSessionId: 'user',
      role: 'primary',
      ts: action.session.lineage?.forkedAt ?? action.session.updatedAt,
      kind: 'text',
      text: pending.prompt,
      author: 'user',
    };
    next = appendTranscriptEvent(next, seed);
  }
  if (!pending || action.session.lineage?.kind !== 'fork') return next;
  return reducer(next, { type: 'SET_ACTIVE_SESSION', id: appSessionId });
}
