import { useMemo } from 'react';
import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import { useThreadDigests } from './useThreadDigests';
import { projectForSession } from '../../lib/projectThreads';
import { sessionAttention } from '../../lib/sessionAttention';
import { useProjects } from './client';
import { projectPulse, type ProjectPulse } from './projectBoard';
import { leadRow, threadRows, type ThreadRow, type ThreadSignals } from './threadBoard';
import type { ProjectView } from './types';

export interface ProjectBoardEntry {
  project: ProjectView;
  rows: ThreadRow[];
  pulse: ProjectPulse;
}

/* Every project with its threads resolved against the live sessions. The
   Projects view and the Threads pane take their rows from here, and a chat's
   spawn line reads its one row through the same threadRows, so a thread reads
   the same wherever it is shown. */
export function useProjectBoard(): {
  entries: ProjectBoardEntry[];
  loading: boolean;
  error?: string;
} {
  const snapshot = useProjects();
  // Only the threads: a lead's digest would feed nothing shown here, and
  // reading it would redraw every board on each token the lead streams.
  const signals = useThreadSignals(
    useMemo(
      () =>
        snapshot.projects.flatMap((project) =>
          project.threads
            .filter((thread) => thread.ownerAppSessionId)
            .map((thread) => thread.appSessionId),
        ),
      [snapshot.projects],
    ),
  );
  const entries = useMemo(
    () =>
      snapshot.projects.map((project) => {
        const rows = threadRows(project, signals);
        return { project, rows, pulse: projectPulse(project, rows, leadRow(project, signals)) };
      }),
    [snapshot.projects, signals],
  );
  return {
    entries,
    loading: snapshot.loading,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

/** What a thread's row is read against, with the last step of the named threads only. */
export function useThreadSignals(threadIds: readonly string[]): ThreadSignals {
  const live = useStoreSelector(
    (state) => ({
      sessions: state.sessions,
      pendingPermissions: state.pendingPermissions,
      pendingQuestions: state.pendingQuestions,
    }),
    shallowEqual,
  );
  const digests = useThreadDigests(threadIds);
  return useMemo(
    () => ({
      sessions: live.sessions,
      attention: (id) => sessionAttention(id, live.pendingPermissions, live.pendingQuestions),
      digests,
    }),
    [live, digests],
  );
}

/** The entry of the project a conversation belongs to, if it is in one. */
export function entryForSession(
  entries: readonly ProjectBoardEntry[],
  appSessionId: string | null | undefined,
): ProjectBoardEntry | undefined {
  const project = projectForSession(
    entries.map((entry) => entry.project),
    appSessionId,
  );
  return entries.find((entry) => entry.project === project);
}
