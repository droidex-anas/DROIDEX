import type { AppState } from '../hooks/useStore';
import type { SessionSummary } from '../types/bridge';
import {
  SIDEBAR_ROW_LIMITS as LIMITS,
  type SidebarMark,
  type SidebarMarkOutcome,
  type SidebarRequest,
  type SidebarResult,
  type SidebarRow,
} from '../types/sidebar';
import { chatDisplayTitle, isChatHidden, isChatPinned, type ChatMetadataMap } from './chatMetadata';
import { projectThreadIds } from './projectThreads';
import {
  ACTIVITY_LABELS,
  canSettleSession,
  chatActivitySignals,
  sessionActivityStatus,
  type SessionActivityStatus,
  type SidebarActivityPreferences,
} from './sidebarActivity';
import { sidebarPreferences, updateSidebarPreferences } from './sidebarPreferences';

/* The window's answers to the sidecar's questions about the sidebar. Each
   answer comes from one read of the store and the saved preferences, so it
   works whether or not the Sidebar is mounted, and costs nothing between
   requests. */

// The sidecar gives up at expiresAt. Stopping a second before leaves time for
// the answer to reach it, so the window never applies a change the sidecar
// has already reported as failed.
const EXPIRY_MARGIN_MS = 1_000;

type SidebarState = Pick<
  AppState,
  | 'sessions'
  | 'sessionOrder'
  | 'chatMetadata'
  | 'projects'
  | 'pendingPermissions'
  | 'pendingQuestions'
  | 'activeAppSessionId'
  | 'sessionLastSeen'
>;

/** Null when the request is too close to expiring to answer or act on. */
export function answerSidebarRequest(
  request: SidebarRequest,
  state: SidebarState,
  archiveChat: (appSessionId: string) => void,
): SidebarResult | null {
  if (Date.now() > request.expiresAt - EXPIRY_MARGIN_MS) return null;
  const { requestId, query } = request;
  if (query.kind === 'rows')
    return { requestId, kind: 'rows', rows: sidebarRows(state, query.appSessionIds) };
  return {
    requestId,
    kind: 'mark',
    outcomes: applyMark(state, archiveChat, query.mark, query.targets),
  };
}

function sidebarRows(state: SidebarState, appSessionIds?: string[]): SidebarRow[] {
  const preferences = sidebarPreferences();
  const rows: SidebarRow[] = [];
  for (const id of appSessionIds ? new Set(appSessionIds) : state.sessionOrder) {
    if (rows.length === LIMITS.rows) break;
    const session = sidebarChat(state, id);
    if (session) rows.push(sidebarRow(state, session, preferences));
  }
  return rows;
}

function sidebarRow(
  state: SidebarState,
  session: SessionSummary,
  preferences: Pick<SidebarActivityPreferences, 'settled' | 'reopened'>,
): SidebarRow {
  const id = session.appSessionId;
  const metadata: Partial<ChatMetadataMap> = state.chatMetadata;
  const signals = chatActivitySignals(session, state, preferences);
  const status = sessionActivityStatus(session, signals);
  const row: SidebarRow = {
    appSessionId: id,
    title: chatDisplayTitle(session, metadata[id]).slice(0, LIMITS.title),
    status,
    label: ACTIVITY_LABELS[status],
    unread: signals.unread,
  };
  if (id === state.activeAppSessionId) row.onScreen = true;
  if (isChatPinned(metadata[id])) row.pinned = true;
  if (signals.settledAt !== undefined) row.settledAt = signals.settledAt;
  if (signals.prDone) row.prDone = true;
  const permission = Object.hasOwn(state.pendingPermissions, id)
    ? state.pendingPermissions[id]
    : undefined;
  if (permission)
    row.permission = {
      title: permission.title.slice(0, LIMITS.title),
      detail: permission.detail.slice(0, LIMITS.permissionDetail),
    };
  const question = Object.hasOwn(state.pendingQuestions, id)
    ? state.pendingQuestions[id]
    : undefined;
  if (question)
    row.question = {
      requestId: question.requestId,
      questions: question.questions.slice(0, LIMITS.questions).map((item) => ({
        index: item.index,
        question: item.question.slice(0, LIMITS.questionText),
        options: item.options
          .slice(0, LIMITS.options)
          .map((option) => option.slice(0, LIMITS.optionText)),
      })),
    };
  return row;
}

function applyMark(
  state: SidebarState,
  archiveChat: (appSessionId: string) => void,
  mark: SidebarMark,
  targets: { appSessionId: string; updatedAt: number }[],
): SidebarMarkOutcome[] {
  const preferences = sidebarPreferences();
  const settled = new Map(Object.entries(preferences.settled));
  const reopened = new Set(preferences.reopened);
  const outcomes = targets.map(({ appSessionId, updatedAt }): SidebarMarkOutcome => {
    const session = sidebarChat(state, appSessionId);
    if (!session) return { appSessionId, done: false, reason: 'Not in the sidebar.' };
    const signals = chatActivitySignals(session, state, preferences);
    const reason = markRefusal(mark, sessionActivityStatus(session, signals), {
      onScreen: appSessionId === state.activeAppSessionId,
      hasNewActivity: session.updatedAt > updatedAt,
    });
    if (reason) return { appSessionId, done: false, reason };
    if (mark === 'archived') archiveChat(appSessionId);
    else if (mark === 'settled') settled.set(appSessionId, updatedAt);
    else {
      // The sidebar's own reopen: a chat whose pull requests all closed needs
      // the override too, or it would settle again at once.
      settled.delete(appSessionId);
      if (signals.prDone) reopened.add(appSessionId);
    }
    return { appSessionId, done: true };
  });
  if (mark === 'archived' || !outcomes.some((outcome) => outcome.done)) return outcomes;
  const next = {
    ...preferences,
    settled: Object.fromEntries(settled),
    reopened: [...reopened],
  };
  if (updateSidebarPreferences(next)) return outcomes;
  return outcomes.map((outcome) =>
    outcome.done
      ? {
          appSessionId: outcome.appSessionId,
          done: false,
          reason: 'Could not save sidebar preferences.',
        }
      : outcome,
  );
}

// A chat the sidebar shows: known, not archived or deleted, and not a project
// thread, which Projects shows instead.
function sidebarChat(state: SidebarState, appSessionId: string): SessionSummary | undefined {
  if (!Object.hasOwn(state.sessions, appSessionId)) return undefined;
  if (projectThreadIds(state.projects).has(appSessionId)) return undefined;
  const metadata: Partial<ChatMetadataMap> = state.chatMetadata;
  return isChatHidden(metadata[appSessionId]) ? undefined : state.sessions[appSessionId];
}

// The sidebar's own rules for its settle and archive gestures, checked at the
// moment the change applies.
function markRefusal(
  mark: SidebarMark,
  status: SessionActivityStatus,
  chat: { onScreen: boolean; hasNewActivity: boolean },
): string | undefined {
  switch (mark) {
    case 'settled':
      if (status === 'settled') return 'It is already settled.';
      if (!canSettleSession(status)) return busyReason(status);
      return chat.hasNewActivity ? 'It has new activity.' : undefined;
    case 'reopened':
      return status === 'settled' ? undefined : 'It is not settled.';
    case 'archived':
      if (chat.onScreen) return 'It is open on screen.';
      return canSettleSession(status) ? undefined : busyReason(status);
  }
}

function busyReason(status: SessionActivityStatus): string {
  return status === 'working' ? 'It has a turn running.' : 'It is waiting on the user.';
}
