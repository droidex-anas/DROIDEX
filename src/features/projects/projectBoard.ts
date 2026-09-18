import type { ThreadRow } from './threadBoard';
import { threadCounts } from './threadBoard';
import type { ProjectView } from './types';

/* What a project looks like from outside: whether anything is waiting on the
   user, whether anything is moving, and when it last did. The list and the
   navigation both read this, so a project says the same thing wherever it is
   mentioned. */

export interface ProjectPulse {
  attention: number;
  working: number;
  settled: number;
  live: boolean;
  updatedAt: number;
  summary: string;
}

export function projectPulse(project: ProjectView, rows: readonly ThreadRow[]): ProjectPulse {
  const counts = threadCounts(rows);
  const live = rows.some((row) => row.live) || project.launching > 0;
  const updatedAt = rows.reduce((newest, row) => Math.max(newest, row.updatedAt), 0);
  return { ...counts, live, updatedAt, summary: summarize(project, counts, rows.length) };
}

function summarize(
  project: ProjectView,
  counts: { attention: number; working: number; settled: number },
  total: number,
): string {
  const parts: string[] = [];
  if (counts.attention > 0)
    parts.push(plural(counts.attention, 'thread needs you', 'threads need you'));
  if (counts.working > 0) parts.push(plural(counts.working, 'thread working', 'threads working'));
  if (project.launching > 0) parts.push('starting a thread');
  if (parts.length === 0)
    parts.push(total === 0 ? 'No threads yet' : plural(total, 'thread settled', 'threads settled'));
  if (project.queued > 0) parts.push(`${String(project.queued)} queued`);
  return parts.join(' · ');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}
