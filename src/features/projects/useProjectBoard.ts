import { useCallback, useMemo } from 'react';
import { shallowEqual, useStoreSelector, type AppState } from '../../hooks/useStore';
import { chatDisplayTitle } from '../../lib/chatMetadata';
import { useThreadDigests } from './useThreadDigests';
import { projectForSession } from '../../lib/projectThreads';
import { sessionAttention } from '../../lib/sessionAttention';
import { useProjects } from './client';
import { projectPulse, type ProjectPulse } from './projectBoard';
import {
  leadRow,
  projectLead,
  threadRows,
  type ThreadRow,
  type ThreadSignals,
} from './threadBoard';
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
  const leadTitles = useLeadTitles(snapshot.projects);
  const entries = useMemo(
    () =>
      snapshot.projects.map((project) => {
        const rows = threadRows(project, signals);
        const lead = projectLead(project);
        const title = lead ? leadTitles[lead.appSessionId] : undefined;
        const named = title && title !== project.title ? { ...project, title } : project;
        return { project: named, rows, pulse: projectPulse(named, rows, leadRow(named, signals)) };
      }),
    [snapshot.projects, signals, leadTitles],
  );
  return {
    entries,
    loading: snapshot.loading,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

/* A project is its lead conversation, so it carries the name that chat has now:
   one started by voice is named from the first thing said in it, and renaming
   the chat renames the project. */
function useLeadTitles(projects: readonly ProjectView[]): Record<string, string> {
  const leads = useMemo(
    () => projects.flatMap((project) => projectLead(project)?.appSessionId ?? []),
    [projects],
  );
  return useStoreSelector(
    useCallback(
      (state: AppState) => {
        const titles: Record<string, string> = {};
        const known: Partial<AppState['sessions']> = state.sessions;
        for (const id of leads) {
          const session = known[id];
          if (session) titles[id] = chatDisplayTitle(session, state.chatMetadata[id]);
        }
        return titles;
      },
      [leads],
    ),
    shallowEqual,
  );
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
      asking: (id) => {
        const permission = live.pendingPermissions[id]?.[0];
        const asked = [
          permission?.detail,
          permission?.title,
          live.pendingQuestions[id]?.[0]?.questions[0]?.question,
        ].find((text) => text?.trim());
        return asked?.trim().split('\n')[0];
      },
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
