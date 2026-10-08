import { threadCounts, type ThreadCounts, type ThreadRow } from './threadBoard';
import type { ProjectView } from './types';

/* What a project looks like on the Projects list: whether anything is waiting
   on the user, whether anything is moving, and when it last did. The navigation
   badge is narrower and counts only approvals and questions. */

export interface ProjectPulse {
  attention: number;
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
    attention: counts.attention + leadCounts.attention,
    live,
    updatedAt,
    summary: summarize(project, counts, leadCounts, rows.length),
  };
}

// One phrase for where the project stands, never a sentence of counts: the
// project's own page has the detail.
function summarize(
  project: ProjectView,
  counts: ThreadCounts,
  lead: ThreadCounts,
  total: number,
): string {
  if (project.paused) return 'Paused';
  if (project.done) return 'Done';
  if (project.leadStopped) return 'Lead stopped';
  if (lead.attention + counts.attention > 0) return 'Needs an answer';
  if (lead.working + counts.working > 0) return 'Working';
  if (counts.queued + counts.waiting + project.queued > 0) return 'Waiting for a slot';
  if (project.launching > 0) return 'Starting a thread';
  return total === 0 ? 'No threads yet' : 'Idle';
}
