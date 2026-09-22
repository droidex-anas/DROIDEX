import { useMemo } from 'react';
import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import { useThreadDigests } from './useThreadDigests';
import { sessionAttention } from '../../lib/sessionAttention';
import { useProjects } from './client';
import { projectPulse, type ProjectPulse } from './projectBoard';
import { threadRows, type ThreadRow } from './threadBoard';
import type { ProjectView } from './types';

export interface ProjectBoardEntry {
  project: ProjectView;
  rows: ThreadRow[];
  pulse: ProjectPulse;
}

/* Every project with its threads resolved against the live sessions, so the
   Projects view, its rows and the navigation all read one board rather than
   each deriving its own. */
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
        const rows = threadRows(project, {
          sessions: signals.sessions,
          attention: (id) =>
            sessionAttention(id, signals.pendingPermissions, signals.pendingQuestions),
          digests,
        });
        return { project, rows, pulse: projectPulse(project, rows) };
      }),
    [snapshot.projects, signals, digests],
  );
  return {
    entries,
    loading: snapshot.loading,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}
