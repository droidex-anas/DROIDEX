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
   Projects view, the Threads pane and a chat's spawn lines all take their rows
   from here, so a thread reads the same wherever it is shown. */
export function useProjectBoard(): {
  entries: ProjectBoardEntry[];
  loading: boolean;
  error?: string;
} {
  const snapshot = useProjects();
  const signals = useStoreSelector(
    (current) => ({
      sessions: current.sessions,
      pendingPermissions: current.pendingPermissions,
      pendingQuestions: current.pendingQuestions,
    }),
    shallowEqual,
  );
  const digests = useThreadDigests(
    useMemo(
      () => snapshot.projects.flatMap((project) => project.threads.map((t) => t.appSessionId)),
      [snapshot.projects],
    ),
  );
  const entries = useMemo(
    () =>
      snapshot.projects.map((project) => {
        const threadSignals: ThreadSignals = {
          sessions: signals.sessions,
          attention: (id) =>
            sessionAttention(id, signals.pendingPermissions, signals.pendingQuestions),
          digests,
        };
        const rows = threadRows(project, threadSignals);
        return {
          project,
          rows,
          pulse: projectPulse(project, rows, leadRow(project, threadSignals)),
        };
      }),
    [snapshot.projects, signals, digests],
  );
  return {
    entries,
    loading: snapshot.loading,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
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
