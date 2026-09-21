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

/** Where an open thread came from, so its chat can offer the way back. */
export interface ThreadOrigin {
  ownerAppSessionId: string;
  /** The conversation that started it: the project's own name. */
  projectTitle: string;
  threadTitle: string;
}

export function threadOrigin(
  projects: readonly ProjectView[],
  appSessionId: string | undefined,
): ThreadOrigin | undefined {
  if (!appSessionId) return undefined;
  for (const project of projects) {
    for (const thread of project.threads) {
      if (thread.appSessionId !== appSessionId || !thread.ownerAppSessionId) continue;
      return {
        ownerAppSessionId: thread.ownerAppSessionId,
        projectTitle: project.title,
        threadTitle: thread.title,
      };
    }
  }
  return undefined;
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
