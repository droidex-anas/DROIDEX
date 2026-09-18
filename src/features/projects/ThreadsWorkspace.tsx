import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useActivityDigests } from '../../hooks/useActivityDigests';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { sessionAttention } from '../../lib/sessionAttention';
import { workspaceName } from '../../lib/workspaces';
import type { UtilityTab } from '../../lib/utilityPanel';
import { pauseProject, spawnThread, stopThread, useProjects } from './client';
import { ThreadDetail } from './ThreadDetail';
import { ThreadList } from './ThreadList';
import { projectForSession, threadRows } from './threadBoard';

/* The Threads tab of the utility panel: every thread this chat runs, grouped by
   what it needs, and the one thread the user opened. One level deep, like the
   Subagents tab — a thread never takes over the tab strip.

   Threads are top-level conversations, so the panel reads the same session
   signals the sidebar does and leaves the chat itself in the main pane. */

export function ThreadsWorkspace({ tab }: { tab: UtilityTab }) {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion() === true;
  const snapshot = useProjects();
  const [now, setNow] = useState(() => Date.now());
  const state = useStoreSelector((current) => {
    const session = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : undefined;
    return {
      session,
      sessions: current.sessions,
      pendingPermissions: current.pendingPermissions,
      pendingQuestions: current.pendingQuestions,
      transcripts: current.transcripts,
      toolActivity: current.toolActivity,
    };
  }, shallowEqual);
  const digests = useActivityDigests(true);
  const { session } = state;
  const project = projectForSession(snapshot.projects, session?.appSessionId);

  const rows = useMemo(
    () =>
      threadRows(project, {
        sessions: state.sessions,
        attention: (id) => sessionAttention(id, state.pendingPermissions, state.pendingQuestions),
        digests,
      }),
    [project, state.sessions, state.pendingPermissions, state.pendingQuestions, digests],
  );

  // Relative times stay honest without a per-second render of the whole panel.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const open = rows.find((row) => row.appSessionId === tab.threadId);
  const showThread = (threadId: string | null) => {
    dispatch({ type: 'UPDATE_UTILITY_TAB', tabId: tab.id, threadId });
  };
  const starter = useThreadStarter(session?.appSessionId, showThread);

  return (
    <div data-testid="threads-workspace" className="flex h-full min-h-0 flex-col">
      <PaneTransition open={Boolean(open)} reduceMotion={reduceMotion} viewKey={open?.appSessionId}>
        {open ? (
          <ThreadDetail
            row={open}
            transcript={state.transcripts[open.appSessionId]}
            toolActivity={state.toolActivity}
            onBack={() => {
              showThread(null);
            }}
            onStop={() => {
              const main = project?.threads.find((thread) => !thread.ownerAppSessionId);
              if (main) void stopThread(main.appSessionId, open.appSessionId);
            }}
            onOpenInChat={() => {
              dispatch({ type: 'SET_ACTIVE_SESSION', id: open.appSessionId });
            }}
          />
        ) : (
          <ThreadList
            rows={rows}
            subtitle={subtitle(project?.title, session?.cwd, rows.length)}
            now={now}
            busy={starter.busy || Boolean(project?.launching)}
            error={starter.error === '' ? (project?.error ?? '') : starter.error}
            paused={project?.paused ?? false}
            uncertain={project?.uncertain ?? 0}
            onResume={() => {
              if (project) void pauseProject(project.id, false, true);
            }}
            onOpenThread={showThread}
            onStartThread={starter.start}
          />
        )}
      </PaneTransition>
    </div>
  );
}

/* Going into a thread and coming back is a lateral move, so the two views slide
   past each other the way the Subagents pane's do. */
function PaneTransition({
  open,
  reduceMotion,
  viewKey,
  children,
}: {
  open: boolean;
  reduceMotion: boolean;
  viewKey: string | undefined;
  children: ReactNode;
}) {
  const travel = reduceMotion ? 0 : 12;
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={open ? `detail:${viewKey ?? ''}` : 'list'}
        initial={{ opacity: 0, x: open ? travel : -travel }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: open ? -travel : travel }}
        transition={{
          duration: reduceMotion ? 0 : INLINE_CARD_DURATION_S,
          ...(reduceMotion ? {} : { ease: INLINE_CARD_EASE }),
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* Starting a thread by hand. It carries only the task: its harness, model,
   reasoning, autonomy and workspace come from the chat, and its name is the
   task's first line — the same rule the new-project form follows. */
function useThreadStarter(appSessionId: string | undefined, onStarted: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = (prompt: string) => {
    if (!appSessionId || busy) return;
    setBusy(true);
    setError('');
    spawnThread(appSessionId, { title: prompt.split('\n')[0].slice(0, 80), prompt })
      .then(onStarted)
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return { busy, error, start };
}

function subtitle(title: string | undefined, cwd: string | undefined, count: number): string {
  const folder = cwd ? workspaceName(cwd) : '';
  const threads = count === 1 ? '1 thread' : `${String(count)} threads`;
  return [title ?? 'This chat', threads, folder].filter(Boolean).join(' · ');
}
