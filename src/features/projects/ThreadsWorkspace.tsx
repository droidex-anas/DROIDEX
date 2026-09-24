import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useThreadDigests } from './useThreadDigests';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { sessionAttention } from '../../lib/sessionAttention';
import { workspaceName } from '../../lib/workspaces';
import type { UtilityTab } from '../../lib/utilityPanel';
import { useProjects } from './client';
import { ThreadDetail } from './ThreadDetail';
import { ThreadList } from './ThreadList';
import { projectForSession } from '../../lib/projectThreads';
import { threadRows } from './threadBoard';
import type { ProjectStep } from './types';

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
      sessionRestore: current.sessionRestore,
      toolActivity: current.toolActivity,
    };
  }, shallowEqual);
  const { session } = state;
  const project = projectForSession(snapshot.projects, session?.appSessionId);
  const digests = useThreadDigests(
    project?.threads.map((thread) => thread.appSessionId) ?? EMPTY_IDS,
  );

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

  return (
    <div data-testid="threads-workspace" className="flex h-full min-h-0 flex-col">
      <PaneTransition open={Boolean(open)} reduceMotion={reduceMotion} viewKey={open?.appSessionId}>
        {open ? (
          <ThreadDetail
            row={open}
            transcript={state.transcripts[open.appSessionId]}
            historyError={state.sessionRestore[open.appSessionId]?.error ?? ''}
            toolActivity={state.toolActivity}
            onBack={() => {
              showThread(null);
            }}
            onOpenInChat={() => {
              dispatch({ type: 'SET_ACTIVE_SESSION', id: open.appSessionId });
            }}
          />
        ) : (
          <ThreadList
            rows={rows}
            plan={project?.plan ?? EMPTY_PLAN}
            subtitle={subtitle(project?.title, session?.cwd, rows.length)}
            held={project?.paused === true}
            now={now}
            error={project?.error ?? ''}
            activeAppSessionId={session?.appSessionId}
            onOpenThread={showThread}
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

const EMPTY_PLAN: ProjectStep[] = [];
const EMPTY_IDS: string[] = [];

function subtitle(title: string | undefined, cwd: string | undefined, count: number): string {
  const folder = cwd ? workspaceName(cwd) : '';
  const threads = count === 1 ? '1 thread' : `${String(count)} threads`;
  return [title ?? 'This chat', threads, folder].filter(Boolean).join(' · ');
}
