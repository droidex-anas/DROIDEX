import { workspaceName } from '../../lib/workspaces';
import { formatDuration } from '../usage/usageCopy';
import type { ThreadCounts, ThreadRow } from './threadBoard';
import type { ProjectDone } from './types';

// The panel's headline: one plain line for where the project stands. The lines
// under it carry the facts.

type Mood = 'attention' | 'done' | 'working' | 'waiting' | 'settled' | 'empty';

const LINES: Record<Mood, string> = {
  attention: 'Something needs an answer.',
  done: 'Goal reached.',
  working: 'The team is working.',
  waiting: 'Work is waiting for a slot.',
  settled: 'All quiet.',
  empty: 'No threads yet.',
};

const MINUTE = 60_000;

function elapsed(ms: number): string {
  return ms < MINUTE ? 'under a minute' : formatDuration(ms);
}

export function threadGreeting(
  rows: readonly ThreadRow[],
  counts: ThreadCounts,
  done?: ProjectDone,
): string {
  return LINES[mood(rows, counts, done)];
}

function mood(rows: readonly ThreadRow[], counts: ThreadCounts, done?: ProjectDone): Mood {
  if (counts.attention > 0) return 'attention';
  if (done) return 'done';
  if (counts.working > 0) return 'working';
  if (counts.queued > 0 || counts.waiting > 0) return 'waiting';
  return rows.length > 0 ? 'settled' : 'empty';
}

/** How long the project has run, or took, and where it works. */
export function projectTimeline(
  startedAt: number | undefined,
  done: ProjectDone | undefined,
  cwd: string | undefined,
  now: number,
): string {
  const parts: string[] = [];
  if (done && startedAt) parts.push(`Done in ${elapsed(done.at - startedAt)}`);
  else if (done) parts.push('Done');
  else if (startedAt) parts.push(`Running for ${elapsed(now - startedAt)}`);
  if (cwd) parts.push(workspaceName(cwd));
  return parts.join(' · ');
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}
