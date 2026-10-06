import { workspaceName } from '../../lib/workspaces';
import { formatDuration } from '../usage/usageCopy';
import type { ThreadCounts, ThreadRow } from './threadBoard';
import type { ProjectDone } from './types';

// The panel's greeting, which changes through the day; the lines under it have the facts.

type Mood = 'attention' | 'done' | 'working' | 'settled' | 'empty';

const LINES: Record<Mood, readonly string[]> = {
  attention: ['Your turn.', 'Someone needs a word.', 'One call to make.', 'A thread is holding.'],
  done: ['Goal reached.', 'All done.', 'Finished.'],
  working: ['Heads down.', 'Work in flight.', 'The team has it.', 'Wheels turning.'],
  settled: ['All quiet.', 'Nothing pending.', 'Bench is clear.', 'Everything landed.'],
  empty: ['No threads yet.', 'Nothing running.', 'An empty bench.'],
};

const MINUTE = 60_000;
const HOUR = 3_600_000;

function elapsed(ms: number): string {
  return ms < MINUTE ? 'under a minute' : formatDuration(ms);
}

export function threadGreeting(
  rows: readonly ThreadRow[],
  counts: ThreadCounts,
  now: number,
  done?: ProjectDone,
): string {
  const lines = LINES[mood(rows, counts, done)];
  // Stable within the hour, so the line never flickers while the panel updates.
  return lines[Math.floor(now / HOUR) % lines.length];
}

function mood(rows: readonly ThreadRow[], counts: ThreadCounts, done?: ProjectDone): Mood {
  if (counts.attention > 0) return 'attention';
  if (done) return 'done';
  if (counts.working > 0) return 'working';
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
