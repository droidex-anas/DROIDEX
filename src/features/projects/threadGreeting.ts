import { workspaceName } from '../../lib/workspaces';
import { formatDuration } from '../usage/usageCopy';
import type { ProjectDone } from './types';

const MINUTE = 60_000;

function elapsed(ms: number): string {
  return ms < MINUTE ? 'under a minute' : formatDuration(ms);
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
