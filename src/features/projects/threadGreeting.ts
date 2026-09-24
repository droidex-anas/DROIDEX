import { workspaceName } from '../../lib/workspaces';
import type { ThreadCounts, ThreadRow } from './threadBoard';

// The panel's greeting, which changes through the day; the line under it has the facts.

const LINES: Record<'attention' | 'working' | 'settled' | 'empty', readonly string[]> = {
  attention: ['Your turn.', 'Someone needs a word.', 'One call to make.', 'A thread is holding.'],
  working: ['Heads down.', 'Work in flight.', 'The team has it.', 'Wheels turning.'],
  settled: ['All quiet.', 'Nothing pending.', 'Bench is clear.', 'Everything landed.'],
  empty: ['No threads yet.', 'Nothing running.', 'An empty bench.'],
};

const HOUR = 3_600_000;

export function threadGreeting(
  rows: readonly ThreadRow[],
  counts: ThreadCounts,
  now: number,
): string {
  const lines = LINES[mood(rows, counts)];
  // Stable within the hour, so the line never flickers while the panel updates.
  return lines[Math.floor(now / HOUR) % lines.length];
}

function mood(
  rows: readonly ThreadRow[],
  counts: ThreadCounts,
): 'attention' | 'working' | 'settled' | 'empty' {
  if (counts.attention > 0) return 'attention';
  if (counts.working > 0) return 'working';
  return rows.length > 0 ? 'settled' : 'empty';
}

/** The facts under the greeting: only what is actually there, in plain words. */
export function threadStatusLine(counts: ThreadCounts): string {
  const parts: string[] = [];
  if (counts.attention > 0)
    parts.push(plural(counts.attention, 'thread needs you', 'threads need you'));
  if (counts.working > 0) parts.push(plural(counts.working, 'thread working', 'threads working'));
  if (counts.idle > 0) parts.push(plural(counts.idle, 'thread idle', 'threads idle'));
  return parts.join(' · ');
}

/** The quiet line under the facts: whose threads these are, how many, and where. */
export function threadSubtitle(
  title: string | undefined,
  cwd: string | undefined,
  count: number,
): string {
  const folder = cwd ? workspaceName(cwd) : '';
  return [title, plural(count, 'thread', 'threads'), folder].filter(Boolean).join(' · ');
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}
