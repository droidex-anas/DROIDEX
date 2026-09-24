import type { ProjectView } from '../features/projects/types';
import type { AppState } from '../hooks/useStore';

/* What the app's chrome needs to know about projects, without loading the
   Projects feature or walking a transcript: which sessions are threads (the
   chat list leaves those to Projects) and whether any project is moving or
   waiting on the user. */

/** Whether the runtime has said which sessions are threads. One that cannot
    answer counts as having answered, or the chat list would never draw. */
export function projectsAnswered(state: Pick<AppState, 'projectsLoaded' | 'connection'>): boolean {
  return state.projectsLoaded || state.connection === 'error';
}

// Kept per snapshot so selectors get the same Set until the projects change.
const threadIdsBySnapshot = new WeakMap<readonly ProjectView[], ReadonlySet<string>>();

export function projectThreadIds(projects: readonly ProjectView[]): ReadonlySet<string> {
  const cached = threadIdsBySnapshot.get(projects);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const project of projects) {
    for (const thread of project.threads) {
      if (thread.ownerAppSessionId) ids.add(thread.appSessionId);
    }
  }
  threadIdsBySnapshot.set(projects, ids);
  return ids;
}

/** Where an open thread came from, so its chat can offer the way back. */
export interface ThreadOrigin {
  ownerAppSessionId: string;
  /** The conversation that started it: the project's name for the lead,
      otherwise the owning thread's own title. */
  ownerTitle: string;
  threadTitle: string;
}

export function threadOrigin(
  projects: readonly ProjectView[],
  appSessionId: string | undefined,
): ThreadOrigin | undefined {
  if (!appSessionId) return undefined;
  for (const project of projects) {
    const thread = project.threads.find((item) => item.appSessionId === appSessionId);
    if (!thread?.ownerAppSessionId) continue;
    const owner = project.threads.find((item) => item.appSessionId === thread.ownerAppSessionId);
    return {
      ownerAppSessionId: thread.ownerAppSessionId,
      ownerTitle: owner?.ownerAppSessionId ? owner.title : project.title,
      threadTitle: thread.title,
    };
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
