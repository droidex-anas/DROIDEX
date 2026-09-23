import type { ThreadRow } from './threadBoard';
import { threadCounts } from './threadBoard';
import type { ThreadCounts } from './threadGreeting';
import type { ProjectView } from './types';

/* What a project looks like from outside: whether anything is waiting on the
   user, whether anything is moving, and when it last did. The list and the
   navigation both read this, so a project says the same thing wherever it is
   mentioned. */

export interface ProjectPulse {
  attention: number;
  working: number;
  idle: number;
  live: boolean;
  updatedAt: number;
  summary: string;
}

/* The lead is read with the threads, because before its first spawn it is
   the whole project: a project whose lead is working is not idle. */
export function projectPulse(
  project: ProjectView,
  rows: readonly ThreadRow[],
  lead: ThreadRow | undefined,
): ProjectPulse {
  const counts = threadCounts(rows);
  const leadCounts = threadCounts(lead ? [lead] : []);
  const everyone = lead ? [lead, ...rows] : rows;
  const live = everyone.some((row) => row.live) || project.launching > 0;
  const updatedAt = everyone.reduce((newest, row) => Math.max(newest, row.updatedAt), 0);
  return {
    ...counts,
    attention: counts.attention + leadCounts.attention,
    live,
    updatedAt,
    summary: summarize(project, counts, leadCounts, rows.length),
  };
}

function summarize(
  project: ProjectView,
  counts: ThreadCounts,
  lead: ThreadCounts,
  total: number,
): string {
  const parts: string[] = [];
  if (lead.attention > 0) parts.push('Main chat needs you');
  else if (lead.working > 0) parts.push('Main chat working');
  if (counts.attention > 0)
    parts.push(plural(counts.attention, 'thread needs you', 'threads need you'));
  if (counts.working > 0) parts.push(plural(counts.working, 'thread working', 'threads working'));
  if (project.launching > 0) parts.push('starting a thread');
  if (parts.length === 0)
    parts.push(total === 0 ? 'No threads yet' : plural(total, 'thread idle', 'threads idle'));
  if (project.queued > 0) parts.push(`${String(project.queued)} queued`);
  return parts.join(' · ');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}
