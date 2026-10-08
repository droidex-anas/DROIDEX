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
   so its state is the one the inbox already computes for a chat, with the same
   statuses, labels and marks. Queued starts and runtime-slot waits come from
   the project snapshot because those threads may have no live session. */

export interface ThreadRow {
  appSessionId: string;
  title: string;
  status: SessionActivityStatus | 'queued' | 'waiting';
  /** What the thread is doing, in the words the rest of the app uses. */
  detail: string;
  live: boolean;
  updatedAt: number;
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
  /** What a blocked thread is asking for, in one line, when it is asking. */
  asking?: (appSessionId: string) => string | undefined;
  digests: Partial<Record<string, ActivityDigest>>;
}

/** The conversation that leads the project: the one no other conversation started. */
export function projectLead(project: ProjectView): ProjectThread | undefined {
  return project.threads.find((thread) => !thread.ownerAppSessionId);
}

/* In tree order: each thread is followed by the threads it started, and every
   level lists its newest first. Grouping keeps that order, so an indented row
   sits under the thread that started it whenever both land in one group. */
export function threadRows(project: ProjectView, signals: ThreadSignals): ThreadRow[] {
  const lead = projectLead(project);
  if (!lead) return [];
  const rows: ThreadRow[] = [];
  const addThreadsOf = (ownerAppSessionId: string, depth: number) => {
    const started = project.threads
      .filter((thread) => thread.ownerAppSessionId === ownerAppSessionId)
      .map((thread) => threadRow(thread, project, signals, depth))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const row of started) {
      rows.push(row);
      addThreadsOf(row.appSessionId, depth + 1);
    }
  };
  addThreadsOf(lead.appSessionId, 0);
  return rows;
}

/** The conversation that leads the project, read the way its threads are. */
export function leadRow(project: ProjectView, signals: ThreadSignals): ThreadRow | undefined {
  const lead = projectLead(project);
  return lead ? threadRow(lead, project, signals, 0) : undefined;
}

/** Inbox groups extended with project waits and queued starts. */
export function threadGroups(rows: readonly ThreadRow[]): ThreadGroup[] {
  const groups: { key: string; label: string; statuses: readonly ThreadRow['status'][] }[] = [
    ...ACTIVITY_GROUPS.slice(0, 2),
    { key: 'waiting', label: 'Waiting', statuses: ['waiting'] },
    { key: 'queued', label: 'Queued', statuses: ['queued'] },
    ...ACTIVITY_GROUPS.slice(2),
  ];
  return groups
    .map((group) => ({
      key: group.key,
      label: group.label,
      rows: rows.filter((row) => group.statuses.includes(row.status)),
    }))
    .filter((group) => group.rows.length > 0);
}

/** Counts for the project summary and Threads greeting. */
export interface ThreadCounts {
  attention: number;
  working: number;
  queued: number;
  waiting: number;
  /** No work pending and no user action needed. */
  idle: number;
}

export function threadCounts(rows: readonly ThreadRow[]): ThreadCounts {
  const attention = rows.filter((row) => needsUser(row.status)).length;
  const working = rows.filter((row) => row.status === 'working').length;
  const queued = rows.filter((row) => row.status === 'queued').length;
  const waiting = rows.filter((row) => row.status === 'waiting').length;
  return {
    attention,
    working,
    queued,
    waiting,
    idle: rows.length - attention - working - queued - waiting,
  };
}

function needsUser(status: ThreadRow['status']): boolean {
  const statuses: readonly ThreadRow['status'][] = ACTIVITY_GROUPS[0].statuses;
  return statuses.includes(status);
}

function threadRow(
  thread: ProjectThread,
  project: ProjectView,
  { sessions, attention, asking, digests }: ThreadSignals,
  depth: number,
): ThreadRow {
  const session = sessions[thread.appSessionId];
  const digest = digests[thread.appSessionId];
  let status: ThreadRow['status'] = session
    ? sessionActivityStatus(session, {
        attention: attention(thread.appSessionId),
        unread: false,
        // A thread that asked its owner is waiting on the project loop, not on
        // the user. While coordination is paused nothing moves until they
        // resume it, so then it is waiting on them.
        awaitingReply: thread.waiting && project.paused,
      })
    : 'ready';
  if (thread.state === 'approval' && status !== 'approval') status = 'approval';
  if (thread.state === 'rate-limited') status = 'failed';
  if (thread.state === 'queued') status = 'queued';
  else if (thread.state === 'waiting' && status !== 'approval' && status !== 'input')
    status = 'waiting';
  const live = Boolean(session?.streaming) && !BLOCKED.includes(status);
  return {
    appSessionId: thread.appSessionId,
    title: thread.title,
    status,
    detail: threadDetail(
      thread,
      status,
      live,
      digest,
      asking?.(thread.appSessionId) ?? thread.approval?.summary,
    ),
    live,
    updatedAt: session?.updatedAt ?? 0,
    depth,
    ...(session?.provider ? { provider: session.provider } : {}),
    ...(session?.modelId ? { modelId: session.modelId } : {}),
  };
}

// The mark already carries the state, so the line under the name carries what
// the thread is actually doing or the last thing it said.
function threadDetail(
  thread: ProjectThread,
  status: ThreadRow['status'],
  live: boolean,
  digest: ActivityDigest | undefined,
  asked: string | undefined,
): string {
  const position =
    thread.wait && thread.wait.kind !== 'turn' ? ordinal(thread.wait.position) : undefined;
  if (status === 'queued') return join('Queued', position);
  if (thread.state === 'rate-limited')
    return thread.resetsAt
      ? `Rate limited · send again after ${clockTime(thread.resetsAt)}`
      : 'Rate limited · send again later';
  if (status === 'waiting') {
    if (thread.wait?.kind === 'slot') return join('Waiting for a slot', position);
    return thread.waiting ? 'Waiting for an answer' : 'Waiting';
  }
  // What it wants from the user comes first, even mid-turn: a thread can be
  // generating and still be stopped on an approval.
  if (BLOCKED.includes(status)) return join(ACTIVITY_LABELS[status], asked ?? digest?.snippet);
  if (live) return digest?.activity ?? 'Working';
  if (thread.waiting) return join('Asked the chat that started it', digest?.snippet);
  return digest?.snippet ?? ACTIVITY_LABELS[status];
}

const BLOCKED: readonly ThreadRow['status'][] = [
  'queued',
  'waiting',
  'approval',
  'input',
  'plan',
  'failed',
  'interrupted',
];

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function clockTime(ts: number): string {
  return clockFormat.format(ts);
}

function join(lead: string, snippet: string | undefined): string {
  return snippet === undefined || snippet === '' ? lead : `${lead} · ${snippet}`;
}

function ordinal(position: number): string {
  const lastTwo = position % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][position % 10] ?? 'th');
  return `${String(position)}${suffix}`;
}
