import type { ActivityDigest } from '../../lib/activityDigest';
import type { SessionAttentionKind } from '../../lib/sessionAttention';
import {
  ACTIVITY_GROUPS,
  ACTIVITY_LABELS,
  sessionActivityStatus,
  type SessionActivityStatus,
} from '../../lib/sidebarActivity';
import type { ProviderKind, SessionSummary } from '../../types/bridge';
import type { ProjectThread, ProjectView } from './types';

/* What the Threads surfaces show. A thread is an ordinary DROIDEX conversation,
   so its state is the state the inbox already computes for a chat — the same
   statuses, the same labels, the same marks — rather than a second status
   vocabulary invented for Projects. */

export interface ThreadRow {
  appSessionId: string;
  title: string;
  status: SessionActivityStatus;
  /** What the thread is doing, in the words the rest of the app uses. */
  detail: string;
  live: boolean;
  updatedAt: number;
  /** The conversation that started it, so a thread's own spawns nest under it. */
  ownerAppSessionId?: string;
  /** 0 for a thread of the main chat, 1 for a thread that thread started. */
  depth: number;
  provider?: ProviderKind;
  modelId?: string;
}

export interface ThreadGroup {
  key: string;
  label: string;
  rows: ThreadRow[];
}

export interface ThreadSignals {
  sessions: Partial<Record<string, SessionSummary>>;
  attention: (appSessionId: string) => SessionAttentionKind | null;
  digests: Partial<Record<string, ActivityDigest>>;
}

/** The project a conversation belongs to, if it is in one. */
export function projectForSession(
  projects: readonly ProjectView[],
  appSessionId: string | null | undefined,
): ProjectView | undefined {
  if (!appSessionId) return undefined;
  return projects.find((project) =>
    project.threads.some((thread) => thread.appSessionId === appSessionId),
  );
}

export function threadRows(project: ProjectView | undefined, signals: ThreadSignals): ThreadRow[] {
  if (!project) return [];
  const threads = new Map(project.threads.map((thread) => [thread.appSessionId, thread]));
  const root = project.threads.find((thread) => !thread.ownerAppSessionId);
  return project.threads
    .filter((thread) => thread.ownerAppSessionId)
    .map((thread) => threadRow(thread, project, signals, depthOf(thread, threads, root)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The conversation that leads the project, read the way its threads are. */
export function leadRow(project: ProjectView, signals: ThreadSignals): ThreadRow | undefined {
  const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
  return lead ? threadRow(lead, project, signals, 0) : undefined;
}

/** The inbox's own groups, in its own order, with the empty ones left out. */
export function threadGroups(rows: readonly ThreadRow[]): ThreadGroup[] {
  return ACTIVITY_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    rows: rows.filter((row) => group.statuses.includes(row.status)),
  })).filter((group) => group.rows.length > 0);
}

/** How many threads are in each of the three states a person acts on. */
export function threadCounts(rows: readonly ThreadRow[]): {
  attention: number;
  working: number;
  /** Neither working nor waiting on the user. */
  idle: number;
} {
  const attention = rows.filter((row) => needsUser(row.status)).length;
  const working = rows.filter((row) => row.status === 'working').length;
  return { attention, working, idle: rows.length - attention - working };
}

function needsUser(status: SessionActivityStatus): boolean {
  return ACTIVITY_GROUPS[0].statuses.includes(status);
}

function depthOf(
  thread: ProjectThread,
  threads: ReadonlyMap<string, ProjectThread>,
  root: ProjectThread | undefined,
): number {
  let depth = 0;
  let owner = thread.ownerAppSessionId;
  while (owner && owner !== root?.appSessionId && depth < 8) {
    depth += 1;
    owner = threads.get(owner)?.ownerAppSessionId;
  }
  return depth;
}

function threadRow(
  thread: ProjectThread,
  project: ProjectView,
  { sessions, attention, digests }: ThreadSignals,
  depth: number,
): ThreadRow {
  const session = sessions[thread.appSessionId];
  const digest = digests[thread.appSessionId];
  const status = session
    ? sessionActivityStatus(session, {
        attention: attention(thread.appSessionId),
        unread: false,
        // A thread that asked its owner is waiting on the project loop, not on
        // the user — unless coordination is paused, and then nothing moves
        // until they resume it.
        awaitingReply: thread.waiting && project.paused,
      })
    : 'ready';
  // A thread can be generating and still be stopped on the user; that is not
  // working, so it wears its blocked mark rather than the spinner.
  const live = Boolean(session?.streaming) && !BLOCKED.includes(status);
  return {
    appSessionId: thread.appSessionId,
    title: thread.title,
    status,
    detail: threadDetail(thread, status, live, digest),
    live,
    updatedAt: session?.updatedAt ?? 0,
    depth,
    ...(thread.ownerAppSessionId ? { ownerAppSessionId: thread.ownerAppSessionId } : {}),
    ...(session?.provider ? { provider: session.provider } : {}),
    ...(session?.modelId ? { modelId: session.modelId } : {}),
  };
}

// The mark already carries the state, so the line under the name carries what
// the thread is actually doing or the last thing it said.
function threadDetail(
  thread: ProjectThread,
  status: SessionActivityStatus,
  live: boolean,
  digest: ActivityDigest | undefined,
): string {
  // What it wants from the user comes first, even mid-turn: a thread can be
  // generating and still be stopped on an approval.
  if (BLOCKED.includes(status)) return join(ACTIVITY_LABELS[status], digest?.snippet);
  if (live) return digest?.activity ?? 'Working';
  if (thread.waiting) return join('Asked the main chat', digest?.snippet);
  return digest?.snippet ?? ACTIVITY_LABELS[status];
}

const BLOCKED: readonly SessionActivityStatus[] = [
  'approval',
  'input',
  'plan',
  'failed',
  'interrupted',
];

function join(lead: string, snippet: string | undefined): string {
  return snippet === undefined || snippet === '' ? lead : `${lead} · ${snippet}`;
}
