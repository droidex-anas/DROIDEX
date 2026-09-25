import type { AppState } from '../hooks/useStore';
import type { SessionSummary } from '../types/bridge';
import {
  chatDisplayTitle,
  isChatHidden,
  linkedPrsDone,
  type ChatMetadataMap,
} from './chatMetadata';
import { sessionAttention, type SessionAttentionKind } from './sessionAttention';
import { sessionIsLive, sessionIsUnread } from './sessions';

export type SessionActivityStatus =
  | 'working'
  | 'approval'
  | 'input'
  | 'plan'
  | 'failed'
  | 'interrupted'
  | 'reply'
  | 'review'
  | 'ship'
  | 'ready'
  | 'settled';

export const ACTIVITY_LABELS: Record<SessionActivityStatus, string> = {
  working: 'Working',
  approval: 'Needs approval',
  input: 'Needs input',
  plan: 'Plan waiting',
  failed: 'Failed',
  interrupted: 'Interrupted',
  reply: 'Awaiting your reply',
  review: 'Needs review',
  ship: 'Uncommitted changes',
  ready: 'Recent',
  settled: 'Settled',
};

export interface ActivitySignals {
  attention: SessionAttentionKind | null;
  unread: boolean;
  settledAt?: number;
  // The model spoke last and the user never replied.
  awaitingReply?: boolean;
  // This chat owns a worktree with uncommitted changes.
  uncommitted?: boolean;
  // Every linked pull request is merged or closed.
  prDone?: boolean;
  // The user reopened the chat after its pull requests closed.
  reopened?: boolean;
}

/** The signals behind a chat's sidebar status that the store and the saved
    settle markers hold. The Activity view adds awaitingReply and uncommitted,
    which only it works out while it is on screen. */
export function chatActivitySignals(
  session: SessionSummary,
  state: Pick<
    AppState,
    | 'pendingPermissions'
    | 'pendingQuestions'
    | 'activeAppSessionId'
    | 'sessionLastSeen'
    | 'chatMetadata'
  >,
  preferences: Pick<SidebarActivityPreferences, 'settled' | 'reopened'>,
): ActivitySignals {
  const id = session.appSessionId;
  const metadata: Partial<ChatMetadataMap> = state.chatMetadata;
  return {
    attention: sessionAttention(id, state.pendingPermissions, state.pendingQuestions),
    unread: sessionIsUnread(session, state.activeAppSessionId, state.sessionLastSeen[id]),
    settledAt: preferences.settled[id],
    prDone: linkedPrsDone(metadata[id]),
    reopened: preferences.reopened.includes(id),
  };
}

// Ordered from "blocked on the user" down to "nothing to do": the first rule
// that matches wins, so a live turn beats a stale unread marker and a manual
// settle beats every idle signal.
export function sessionActivityStatus(
  session: SessionSummary,
  signals: ActivitySignals,
): SessionActivityStatus {
  if (signals.attention === 'approval') return 'approval';
  if (signals.attention === 'question') return 'input';
  if (sessionIsLive(session)) return 'working';
  if (session.phase === 'awaiting_plan_approval' || session.phase === 'awaiting_run_start')
    return 'plan';
  if (signals.settledAt !== undefined && session.updatedAt <= signals.settledAt) return 'settled';
  if (session.phase === 'failed') return 'failed';
  if (session.interruptReason) return 'interrupted';
  if (signals.unread) return 'review';
  if (signals.prDone && !signals.reopened) return 'settled';
  if (signals.awaitingReply) return 'reply';
  if (signals.uncommitted) return 'ship';
  return 'ready';
}

export const ACTIVITY_GROUPS: readonly {
  key: SidebarActivityPreferences['filter'];
  label: string;
  statuses: readonly SessionActivityStatus[];
}[] = [
  {
    key: 'attention',
    label: 'Needs you',
    statuses: ['approval', 'input', 'plan', 'failed', 'interrupted', 'reply', 'review'],
  },
  { key: 'working', label: 'Working', statuses: ['working'] },
  { key: 'ship', label: 'To ship', statuses: ['ship'] },
  { key: 'ready', label: 'Recent', statuses: ['ready'] },
  { key: 'settled', label: 'Settled', statuses: ['settled'] },
];

const DAY = 86_400_000;

// How long an idle chat stays in the Activity view. Live and blocked chats
// always show; everything else ages out so thousands of old sessions never
// flood the inbox (they remain reachable from the Workspaces view).
export function inActivityScope(
  status: SessionActivityStatus,
  session: Pick<SessionSummary, 'updatedAt'>,
  now: number,
): boolean {
  const age = now - session.updatedAt;
  switch (status) {
    case 'working':
    case 'approval':
    case 'input':
    case 'plan':
      return true;
    case 'failed':
    case 'interrupted':
    case 'reply':
      return age <= 30 * DAY;
    case 'ship':
      return age <= 14 * DAY;
    default:
      return age <= 7 * DAY;
  }
}

export interface SidebarActivityPreferences {
  view: 'activity' | 'workspaces' | 'pull-requests';
  settled: Record<string, number>;
  // Chats reopened after every linked PR closed, so PR completion no longer
  // settles them. See pruneReopenedSessions for when the override ends.
  reopened: string[];
  order: 'recent' | 'oldest' | 'title';
  filter: 'all' | 'attention' | 'working' | 'ship' | 'ready' | 'settled';
  limit: number;
}

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarActivityPreferences = {
  view: 'workspaces',
  settled: {},
  reopened: [],
  order: 'recent',
  filter: 'all',
  limit: 5,
};

const STORAGE_KEY = 'droid-sidebar-activity';

export function isSidebarOrder(value: unknown): value is SidebarActivityPreferences['order'] {
  return value === 'recent' || value === 'oldest' || value === 'title';
}

export function isSidebarFilter(value: unknown): value is SidebarActivityPreferences['filter'] {
  return (
    value === 'all' ||
    value === 'attention' ||
    value === 'working' ||
    value === 'ship' ||
    value === 'ready' ||
    value === 'settled'
  );
}

export function loadSidebarActivity(storage: Pick<Storage, 'getItem'>): SidebarActivityPreferences {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SIDEBAR_PREFERENCES, settled: {} };
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('view' in value) ||
    (value.view !== 'activity' && value.view !== 'workspaces' && value.view !== 'pull-requests') ||
    !('settled' in value) ||
    !value.settled ||
    typeof value.settled !== 'object' ||
    Array.isArray(value.settled)
  ) {
    throw new Error('Invalid sidebar activity preferences.');
  }
  if (
    !('order' in value) ||
    !isSidebarOrder(value.order) ||
    !('filter' in value) ||
    !isSidebarFilter(value.filter) ||
    !('limit' in value) ||
    typeof value.limit !== 'number' ||
    ![5, 10, 0].includes(value.limit)
  ) {
    throw new Error('Invalid sidebar display preferences.');
  }
  const settled: Record<string, number> = {};
  for (const [id, timestamp] of Object.entries(value.settled)) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      throw new Error('Invalid settled session timestamp.');
    }
    settled[id] = timestamp;
  }
  // Preferences saved before reopening existed have no list.
  const reopened: unknown = 'reopened' in value ? value.reopened : [];
  if (!Array.isArray(reopened) || !reopened.every((id): id is string => typeof id === 'string')) {
    throw new Error('Invalid reopened session list.');
  }
  return {
    view: value.view,
    settled: pruneSettledSessions(settled, {}, {}),
    reopened,
    order: value.order,
    filter: value.filter,
    limit: value.limit,
  };
}

export function saveSidebarActivity(
  storage: Pick<Storage, 'setItem'>,
  value: SidebarActivityPreferences,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function compareSidebarSessions(
  a: SessionSummary,
  b: SessionSummary,
  order: SidebarActivityPreferences['order'],
  metadata?: ChatMetadataMap,
): number {
  if (order === 'title')
    return (
      chatDisplayTitle(a, metadata?.[a.appSessionId]).localeCompare(
        chatDisplayTitle(b, metadata?.[b.appSessionId]),
      ) || a.appSessionId.localeCompare(b.appSessionId)
    );
  return (
    (order === 'oldest' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt) ||
    a.appSessionId.localeCompare(b.appSessionId)
  );
}

export function matchesActivityFilter(
  status: SessionActivityStatus,
  filter: SidebarActivityPreferences['filter'],
): boolean {
  if (filter === 'all') return true;
  return ACTIVITY_GROUPS.some((group) => group.key === filter && group.statuses.includes(status));
}

export function canSettleSession(status: SessionActivityStatus): boolean {
  return !['working', 'approval', 'input', 'plan'].includes(status);
}

// Keep unloaded history markers, but discard known hidden or superseded entries.
// Retain the newest 1,000 markers so paging through history cannot grow storage forever.
export function pruneSettledSessions(
  settled: Record<string, number>,
  sessions: Partial<Record<string, SessionSummary>>,
  metadata: ChatMetadataMap,
): Record<string, number> {
  const entries = Object.entries(settled).filter(
    ([id, at]) => !isChatHidden(metadata[id]) && (sessions[id]?.updatedAt ?? at) <= at,
  );
  if (entries.length === Object.keys(settled).length && entries.length <= 1000) return settled;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, 1000));
}

// A reopen only overrides the pull requests that had closed when it was made:
// once a linked PR is open again (or the chat is hidden) the override ends, so
// the next merge settles the chat as usual.
export function pruneReopenedSessions(reopened: string[], metadata: ChatMetadataMap): string[] {
  const kept = reopened.filter((id) => !isChatHidden(metadata[id]) && linkedPrsDone(metadata[id]));
  return kept.length === reopened.length ? reopened : kept;
}
