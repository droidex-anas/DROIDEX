import type { SessionSummary, TranscriptEvent } from '@droidex/protocol';
import { placeCreatedChat, showChat, showNewChat } from '../features/tabs/tabNavigation';
import { isChatInView, newDraft, withoutChats } from '../features/tabs/tabStrip';
import { withoutVoiceSession } from '../features/voice/voiceSessions';
import { isChatHidden, markDesignChat } from '../lib/chatMetadata';
import { isRemoteClient } from '../lib/desktop';
import { sessionIsLive } from '../lib/sessions';
import { settleSideChatStart } from '../lib/sideChats';
import {
  appendTranscriptEvent,
  pruneRemovedSessionState,
  releaseSessionTranscriptWindow,
  withUpdatedTranscript,
} from '../lib/transcriptStoreMemory';
import { estimateTranscriptCost, INACTIVE_TRANSCRIPT_POLICY } from '../lib/transcriptWindow';
import { invalidateSelectedChildOpening, releaseInactiveSelectedChild } from './storeChildSession';
import { closeLiveChat, withoutKey, withTilesSeen } from './storeSessionNavigation';
import type { Action, AppState, CanvasChatRequest } from './useStore';

type SessionsAction = Extract<
  Action,
  {
    type:
      | 'SESSION_CREATED'
      | 'SESSION_FORKED'
      | 'SESSION_UPDATED'
      | 'SESSION_CLOSED'
      | 'SESSION_LIST'
      | 'SET_ACTIVE_SESSION'
      | 'START_CHAT';
  }
>;

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
  action: Extract<SessionsAction, { type: 'SESSION_CREATED' }>,
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
  childReset: AppState,
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
  const targetIsActive = state.activeAppSessionId === appSessionId;
  return {
    activeAppSessionId: shouldActivate ? appSessionId : state.activeAppSessionId,
    draftChat: shouldActivate ? null : state.draftChat,
    draftAutonomy: shouldActivate ? null : state.draftAutonomy,
    draftFastMode: shouldActivate ? false : state.draftFastMode,
    draftContextWindowTokens: shouldActivate ? null : state.draftContextWindowTokens,
    selectedChild: shouldActivate || targetIsActive ? null : childReset.selectedChild,
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

function ownsSessionCreate(
  pending: AppState['pendingCompose'][string],
  session: SessionSummary,
): pending is NonNullable<AppState['pendingCompose'][string]> {
  return pending !== undefined && session.lineage?.kind !== 'side';
}

function reduceSessionCreated(
  state: AppState,
  action: Extract<SessionsAction, { type: 'SESSION_CREATED' }>,
): AppState {
  const pending = state.pendingCompose[action.clientRef];
  // `session.created` is also emitted when an existing session resumes.
  // Only a create matching this renderer's pending compose may take focus;
  // background resumes must never replace the chat the user selected. A
  // side chat opens beside its source, never in its place. A create sent
  // from a tab or tile the user has since left opens there instead.
  const ownsCreate = ownsSessionCreate(pending, action.session);
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
    ...createdSessionFocus(state, action.session.appSessionId, shouldActivate, childReset),
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
function reduceSessionForked(
  state: AppState,
  action: Extract<SessionsAction, { type: 'SESSION_FORKED' }>,
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

function withMonotonicCompactions(
  previous: SessionSummary | undefined,
  incoming: SessionSummary,
): SessionSummary {
  // Compaction generations are monotonic. A delayed resume summary must not
  // put a restored session back on generation zero after history already
  // proved that compactions occurred.
  return previous && (previous.autoCompactions ?? 0) > (incoming.autoCompactions ?? 0)
    ? {
        ...incoming,
        autoCompactions: previous.autoCompactions,
        contextTokens: previous.contextTokens,
        contextRemainingTokens: previous.contextRemainingTokens,
        contextAccuracy: previous.contextAccuracy,
        contextUpdatedAt: previous.contextUpdatedAt,
      }
    : incoming;
}

function updatedContextStats(
  state: AppState,
  previous: SessionSummary | undefined,
  m: SessionSummary,
): AppState['contextStats'] {
  const previousCompactions =
    (previous?.compactedFromProviderSessionIds?.length ?? 0) + (previous?.autoCompactions ?? 0);
  const nextCompactions =
    (m.compactedFromProviderSessionIds?.length ?? 0) + (m.autoCompactions ?? 0);
  return nextCompactions > previousCompactions
    ? {
        ...state.contextStats,
        primary: Object.fromEntries(
          Object.entries(state.contextStats.primary).filter(
            ([appSessionId]) => appSessionId !== m.appSessionId,
          ),
        ),
      }
    : state.contextStats;
}

function reduceSessionUpdated(
  state: AppState,
  action: Extract<SessionsAction, { type: 'SESSION_UPDATED' }>,
): AppState {
  const sessionsById: Partial<AppState['sessions']> = state.sessions;
  const previous = sessionsById[action.session.appSessionId];
  const incoming = action.session;
  const m = withMonotonicCompactions(previous, incoming);
  const contextStats = updatedContextStats(state, previous, m);
  const inView = isChatInView(state, m.appSessionId);
  // The active chat is never unread; a tile beside it is read as it changes.
  const seenInTile =
    inView &&
    m.appSessionId !== state.activeAppSessionId &&
    m.updatedAt > (state.sessionLastSeen[m.appSessionId] ?? 0);
  const next = {
    ...state,
    sessions: { ...state.sessions, [m.appSessionId]: m },
    contextStats,
    sessionLastSeen: seenInTile
      ? { ...state.sessionLastSeen, [m.appSessionId]: m.updatedAt }
      : state.sessionLastSeen,
  };
  if (
    !previous ||
    !sessionIsLive(previous) ||
    sessionIsLive(m) ||
    m.updatedAt <= previous.updatedAt ||
    inView ||
    state.transcriptViewportPinned[m.appSessionId] === false
  )
    return next;
  return releaseSessionTranscriptWindow(next, m.appSessionId, INACTIVE_TRANSCRIPT_POLICY);
}

function reduceSessionClosed(
  state: AppState,
  action: Extract<SessionsAction, { type: 'SESSION_CLOSED' }>,
): AppState {
  const childAccess = { ...state.childAccess };
  const childRuntime = { ...state.childRuntime };
  const childContext = { ...state.contextStats.child };
  delete childAccess[action.appSessionId];
  delete childRuntime[action.appSessionId];
  delete childContext[action.appSessionId];
  return {
    ...state,
    childAccess,
    childRuntime,
    pendingPermissions: Object.fromEntries(
      Object.entries(state.pendingPermissions).filter(([id]) => id !== action.appSessionId),
    ),
    pendingQuestions: Object.fromEntries(
      Object.entries(state.pendingQuestions).filter(([id]) => id !== action.appSessionId),
    ),
    contextStats: { ...state.contextStats, child: childContext },
    pendingAutonomy: Object.fromEntries(
      Object.entries(state.pendingAutonomy).filter(([id]) => id !== action.appSessionId),
    ),
    pendingModelUpdates: Object.fromEntries(
      Object.entries(state.pendingModelUpdates).filter(([id]) => id !== action.appSessionId),
    ),
    agentProcesses: Object.fromEntries(
      Object.entries(state.agentProcesses).filter(([id]) => id !== action.appSessionId),
    ),
    voiceSessions: withoutVoiceSession(state.voiceSessions, action.appSessionId),
    selectedChild:
      state.selectedChild?.parentAppSessionId === action.appSessionId ? null : state.selectedChild,
  };
}

function reduceSessionList(
  state: AppState,
  action: Extract<SessionsAction, { type: 'SESSION_LIST' }>,
  reducer: (state: AppState, action: Action) => AppState,
): AppState {
  const incoming = new Set(action.sessions.map((m) => m.appSessionId));
  // The catalog retains admitted owned chats with unavailable transcripts.
  // Only an omitted catalog record can prune a confirmed row; locally
  // added rows survive until their first catalog listing.
  const confirmed = new Set(state.listConfirmedSessionIds);
  const isConfirmedGone = (id: string) => confirmed.has(id) && !incoming.has(id);
  const map: Record<string, SessionSummary> = {};
  for (const [id, summary] of Object.entries(state.sessions)) {
    if (isConfirmedGone(id)) continue;
    map[id] = summary;
  }
  for (const m of action.sessions) {
    map[m.appSessionId] = m;
  }
  const mapById: Partial<AppState['sessions']> = map;
  const order = [
    ...new Set([
      ...action.sessions.map((m) => m.appSessionId),
      ...state.sessionOrder,
      ...Object.keys(state.sessions),
    ]),
  ]
    .filter((id) => mapById[id])
    .sort((a, b) => map[b].updatedAt - map[a].updatedAt);
  const retainedSessionIds = new Set(Object.keys(map));
  const retainedState = pruneRemovedSessionState(state, retainedSessionIds);
  // Seed last-seen for sessions this client has never tracked so existing
  // history is not retroactively marked unread; only activity that arrives
  // after this point (a newer updatedAt) flips a row to unread.
  const seededLastSeen = { ...retainedState.sessionLastSeen };
  const lastSeenById: Partial<AppState['sessionLastSeen']> = seededLastSeen;
  for (const m of action.sessions) {
    if (lastSeenById[m.appSessionId] === undefined) {
      seededLastSeen[m.appSessionId] = m.updatedAt;
    }
  }
  // If the active session was pruned above (a hydrated snapshot row the
  // sidecar no longer reports), clear the dangling id so the UI does not
  // point at a session that no longer exists.
  const activeAppSessionId =
    state.activeAppSessionId !== null && mapById[state.activeAppSessionId] !== undefined
      ? state.activeAppSessionId
      : null;
  // Catalog omission cannot prove a hidden chat will never return.
  // Keep its renderer-only tombstone; prune only orphaned preferences.
  let chatMetadata = state.chatMetadata;
  const orphaned = Object.keys(chatMetadata).filter(
    (id) => isConfirmedGone(id) && !isChatHidden(chatMetadata[id]),
  );
  if (orphaned.length > 0) {
    const drop = new Set(orphaned);
    chatMetadata = Object.fromEntries(Object.entries(chatMetadata).filter(([id]) => !drop.has(id)));
  }
  const listed: AppState = {
    ...retainedState,
    sessions: map,
    sessionOrder: order,
    sessionLastSeen: seededLastSeen,
    chatMetadata,
    listConfirmedSessionIds: action.sessions.map((m) => m.appSessionId),
    earlierSessionsByCwd: action.earlierSessionsByCwd,
    activeAppSessionId,
    // The list covers every folder in the sidebar, so a restored tab whose
    // chat neither it nor the snapshot knows has nothing to show.
    tabStrip: withoutChats(state.tabStrip, (id) => mapById[id] === undefined),
  };
  // A focused tile whose chat is gone closes like any other, so the tile
  // beside it comes forward instead of a second new chat.
  const goneTile =
    state.activeAppSessionId !== null && activeAppSessionId === null
      ? closeLiveChat(state, state.activeAppSessionId)
      : null;
  return goneTile?.type === 'CLOSE_TILE' ? reducer(listed, goneTile) : listed;
}

function reduceSetActiveSession(
  state: AppState,
  action: Extract<SessionsAction, { type: 'SET_ACTIVE_SESSION' }>,
): AppState {
  const sessionsById: Partial<AppState['sessions']> = state.sessions;
  // Stamp "seen now" on both the session being left (so responses received
  // while it was open count as read) and the one being opened (clears its
  // unread state immediately).
  const now = Date.now();
  const sessionLastSeen = { ...state.sessionLastSeen };
  if (state.activeAppSessionId && sessionsById[state.activeAppSessionId]) {
    sessionLastSeen[state.activeAppSessionId] = now;
  }
  if (action.id) sessionLastSeen[action.id] = now;
  const tabStrip = action.id ? showChat(state, action.id) : showNewChat(state, null);
  let next = invalidateSelectedChildOpening(releaseInactiveSelectedChild(state));
  const outgoingAppSessionId = state.activeAppSessionId;
  const outgoingSession = outgoingAppSessionId ? sessionsById[outgoingAppSessionId] : undefined;
  if (
    outgoingAppSessionId &&
    outgoingSession &&
    !sessionIsLive(outgoingSession) &&
    state.transcriptViewportPinned[outgoingAppSessionId] !== false &&
    // A chat left for another tile stays on screen.
    !isChatInView(
      { mainView: 'session', activeAppSessionId: action.id, tabStrip },
      outgoingAppSessionId,
    )
  ) {
    next = releaseSessionTranscriptWindow(next, outgoingAppSessionId, INACTIVE_TRANSCRIPT_POLICY);
  }
  return withTilesSeen(
    {
      ...next,
      activeAppSessionId: action.id,
      sessionLastSeen,
      draftChat: null,
      draftAutonomy: null,
      draftFastMode: false,
      draftContextWindowTokens: null,
      selectedChild: null,
      // A pending review-focus request belongs to the session that issued
      // it; never let it fire in another session's panel after a switch.
      reviewFocusPath: action.id === state.activeAppSessionId ? state.reviewFocusPath : null,
      reviewFocusChange: action.id === state.activeAppSessionId ? state.reviewFocusChange : null,
      mainView: 'session',
      automationEditorRequest: null,
      tabStrip,
    },
    now,
  );
}

function reduceStartChat(
  state: AppState,
  action: Extract<SessionsAction, { type: 'START_CHAT' }>,
  reducer: (state: AppState, action: Action) => AppState,
): AppState {
  const sessionsById: Partial<AppState['sessions']> = state.sessions;
  // Design previews run in the laptop's own window, so a Remote browser
  // starts a chat wherever a design would start.
  if (action.canvas && isRemoteClient()) {
    return reducer(state, { type: 'START_CHAT', ...newDraft(state, 'chat') });
  }
  // Stamp the session being left so model output produced while it was
  // open doesn't surface as an unread badge after starting a new chat.
  const sessionLastSeen = { ...state.sessionLastSeen };
  if (state.activeAppSessionId && sessionsById[state.activeAppSessionId]) {
    sessionLastSeen[state.activeAppSessionId] = Date.now();
  }
  const next = invalidateSelectedChildOpening(state);
  const draftChat = {
    cwd: action.cwd,
    executionMode: action.executionMode,
    branch: action.branch,
    ...(action.project ? { project: action.project } : {}),
    ...(action.canvas ? { canvas: action.canvas } : {}),
  };
  return {
    ...next,
    draftChat,
    draftAutonomy: null,
    draftFastMode: false,
    draftContextWindowTokens: null,
    activeAppSessionId: null,
    missionControlMode: false,
    selectedChild: null,
    // Leaving for a fresh draft orphans any pending review-focus request.
    reviewFocusPath: null,
    reviewFocusChange: null,
    sessionLastSeen,
    mainView: 'session',
    automationEditorRequest: null,
    tabStrip: showNewChat(state, draftChat),
  };
}

export function reduceSessions(
  state: AppState,
  action: SessionsAction,
  reducer: (state: AppState, action: Action) => AppState,
): AppState {
  switch (action.type) {
    case 'SESSION_CREATED':
      return reduceSessionCreated(state, action);
    case 'SESSION_FORKED':
      return reduceSessionForked(state, action, reducer);
    case 'SESSION_UPDATED':
      return reduceSessionUpdated(state, action);
    case 'SESSION_CLOSED':
      return reduceSessionClosed(state, action);
    case 'SESSION_LIST':
      return reduceSessionList(state, action, reducer);
    case 'SET_ACTIVE_SESSION':
      return reduceSetActiveSession(state, action);
    case 'START_CHAT':
      return reduceStartChat(state, action, reducer);
  }
}
