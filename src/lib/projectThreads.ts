import type { ProjectView } from '../features/projects/types';

/* What the app's chrome needs to know about projects, without loading the
   Projects feature or walking a transcript: which sessions are threads (the
   chat list leaves those to Projects) and whether any project is moving or
   waiting on the user. */

export function projectThreadIds(projects: readonly ProjectView[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const project of projects) {
    for (const thread of project.threads) {
      if (thread.ownerAppSessionId) ids.add(thread.appSessionId);
    }
  }
  return ids;
}

export interface ProjectsPulse {
  /** Threads stopped on an approval or a question. */
  attention: number;
  live: boolean;
}

export function projectsPulse(
  projects: readonly ProjectView[],
  signals: {
    streaming: (appSessionId: string) => boolean;
    blocked: (appSessionId: string) => boolean;
    launching?: boolean;
  },
): ProjectsPulse {
  let attention = 0;
  let live = false;
  for (const project of projects) {
    if (project.launching > 0) live = true;
    for (const thread of project.threads) {
      if (!thread.ownerAppSessionId) continue;
      if (signals.blocked(thread.appSessionId)) attention += 1;
      else if (signals.streaming(thread.appSessionId)) live = true;
    }
  }
  return { attention, live };
}
