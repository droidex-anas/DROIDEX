import type { ActivityDigest } from '../../lib/activityDigest';
import type { SessionAttentionKind } from '../../lib/sessionAttention';
import type { SessionSummary } from '../../types/bridge';
import type { ProjectThread, ProjectView } from './types';

/* What the Threads panel shows. A thread is an ordinary DROIDEX conversation,
   so its state comes from the same signals the sidebar reads — the session
   summary, a pending approval or question, and the chat's activity digest —
   rather than a second status vocabulary invented for this panel. */

type ThreadState = 'attention' | 'working' | 'idle';

export interface ThreadRow {
  appSessionId: string;
  title: string;
  state: ThreadState;
  /** What the thread is doing, in the words the rest of the app uses. */
  detail: string;
  live: boolean;
  updatedAt: number;
  /** A saved thread whose conversation this window has not loaded. */
  unavailable: boolean;
}

export interface ThreadGroup {
  key: ThreadState;
  label: string;
  rows: ThreadRow[];
}

// Blocked first, then running, then everything settled: the order the panel
// never changes, so a glance always lands on what is waiting.
const GROUP_ORDER: { key: ThreadState; label: string }[] = [
  { key: 'attention', label: 'Needs you' },
  { key: 'working', label: 'Working' },
  { key: 'idle', label: 'Idle' },
];

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
  return project.threads
    .filter((thread) => thread.ownerAppSessionId)
    .map((thread) => threadRow(thread, project, signals))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function threadGroups(rows: readonly ThreadRow[]): ThreadGroup[] {
  return GROUP_ORDER.map((group) => ({
    ...group,
    rows: rows.filter((row) => row.state === group.key),
  })).filter((group) => group.rows.length > 0);
}

/** The one line the panel header states: what, if anything, is on the user. */
export function threadHeadline(rows: readonly ThreadRow[]): string {
  const waiting = rows.filter((row) => row.state === 'attention').length;
  if (waiting === 1) return 'One thread needs you.';
  if (waiting > 1) return `${String(waiting)} threads need you.`;
  const working = rows.filter((row) => row.state === 'working').length;
  if (working === 1) return 'One thread is working.';
  if (working > 1) return `${String(working)} threads are working.`;
  return rows.length > 0 ? 'Every thread is settled.' : 'No threads yet.';
}

function threadRow(
  thread: ProjectThread,
  project: ProjectView,
  { sessions, attention, digests }: ThreadSignals,
): ThreadRow {
  const session = sessions[thread.appSessionId];
  const live = Boolean(session?.streaming);
  return {
    appSessionId: thread.appSessionId,
    title: thread.title,
    live,
    updatedAt: session?.updatedAt ?? 0,
    unavailable: !session,
    ...threadState(thread, project, {
      session,
      live,
      blocked: attention(thread.appSessionId),
      digest: digests[thread.appSessionId],
    }),
  };
}

// The first rule that matches wins, from "blocked on the user" down to "nothing
// left to do" — the order the sidebar's own activity model reads in.
function threadState(
  thread: ProjectThread,
  project: ProjectView,
  context: {
    session: SessionSummary | undefined;
    live: boolean;
    blocked: SessionAttentionKind | null;
    digest: ActivityDigest | undefined;
  },
): Pick<ThreadRow, 'state' | 'detail'> {
  const { session, live, blocked, digest } = context;
  if (!session) return { state: 'idle', detail: 'Saved thread, not loaded yet' };
  const needsUser = blockedDetail(session, blocked);
  if (needsUser) return { state: 'attention', detail: needsUser };
  if (live) return { state: 'working', detail: digest?.activity ?? 'Working' };
  // Its question went to the main chat, which answers it on its next turn —
  // unless coordination is paused, and then it is the user who has to move.
  if (thread.waiting)
    return project.paused
      ? {
          state: 'attention',
          detail: `Asked the main chat, coordination paused${suffix(digest?.snippet)}`,
        }
      : { state: 'working', detail: `Asked the main chat${suffix(digest?.snippet)}` };
  if (session.interruptReason) return { state: 'idle', detail: 'Stopped' };
  return { state: 'idle', detail: orElse(digest?.snippet, 'Finished its turn') };
}

// What the thread wants from the user, when it wants anything.
function blockedDetail(session: SessionSummary, blocked: SessionAttentionKind | null): string {
  if (blocked === 'approval') return 'Waiting for your approval';
  if (blocked === 'question') return 'Asked you a question';
  if (session.phase === 'awaiting_plan_approval' || session.phase === 'awaiting_run_start')
    return 'Plan waiting for you';
  return session.phase === 'failed' ? 'Failed. Open it to see why.' : '';
}

function orElse(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value;
}

function suffix(snippet: string | undefined): string {
  return snippet ? ` · ${snippet}` : '';
}
