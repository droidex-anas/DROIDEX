import { useReducedMotion } from 'framer-motion';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { workspaceName } from '../../lib/workspaces';
import type { UtilityTab } from '../../lib/utilityPanel';
import type { TranscriptEvent } from '../../types/bridge';
import { PaneTransition } from './PaneTransition';
import { ThreadDetail } from './ThreadDetail';
import { ThreadList } from './ThreadList';
import type { ThreadRow } from './threadBoard';
import type { ProjectStep } from './types';
import { entryForSession, useProjectBoard } from './useProjectBoard';
import { useRelativeTimeNow } from './useRelativeTimeNow';

/* The Threads tab of the utility panel: every thread this chat runs, grouped by
   what it needs, and the one thread the user opened. One level deep, like the
   Subagents tab — a thread never takes over the tab strip.

   Threads are top-level conversations, so the panel reads the same session
   signals the sidebar does and leaves the chat itself in the main pane. */

export function ThreadsWorkspace({ tab }: { tab: UtilityTab }) {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion() === true;
  const { entries } = useProjectBoard();
  const now = useRelativeTimeNow();
  const { threadId } = tab;
  const state = useStoreSelector((current) => {
    const session = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : undefined;
    const transcripts: Partial<Record<string, TranscriptEvent[]>> = current.transcripts;
    // Only the open thread's entries: the whole maps change on every token of any chat.
    return {
      session,
      transcript: threadId ? transcripts[threadId] : undefined,
      historyError: threadId ? (current.sessionRestore[threadId]?.error ?? '') : '',
      toolActivity: current.toolActivity,
    };
  }, shallowEqual);
  const { session } = state;
  const entry = entryForSession(entries, session?.appSessionId);
  const project = entry?.project;
  const rows = entry?.rows ?? EMPTY_ROWS;

  const open = rows.find((row) => row.appSessionId === threadId);
  const showThread = (threadId: string | null) => {
    dispatch({ type: 'UPDATE_UTILITY_TAB', tabId: tab.id, threadId });
  };

  return (
    <div data-testid="threads-workspace" className="flex h-full min-h-0 flex-col">
      <PaneTransition open={Boolean(open)} reduceMotion={reduceMotion} viewKey={open?.appSessionId}>
        {open ? (
          <ThreadDetail
            row={open}
            transcript={state.transcript}
            historyError={state.historyError}
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

const EMPTY_PLAN: ProjectStep[] = [];
const EMPTY_ROWS: ThreadRow[] = [];

function subtitle(title: string | undefined, cwd: string | undefined, count: number): string {
  const folder = cwd ? workspaceName(cwd) : '';
  const threads = count === 1 ? '1 thread' : `${String(count)} threads`;
  return [title ?? 'This chat', threads, folder].filter(Boolean).join(' · ');
}
