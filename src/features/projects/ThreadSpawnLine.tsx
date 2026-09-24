import { useState } from 'react';
import { ChevronRight } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useThreadDigests } from './useThreadDigests';
import { sessionAttention } from '../../lib/sessionAttention';
import { Caret, Expand } from '../../components/transcript/primitives';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { toolArgString } from '../../lib/tools';
import type { TranscriptEvent } from '../../types/bridge';
import { useProjects } from './client';
import { projectForSession, threadRows } from './threadBoard';
import { spawnedThread } from './threadToolNames';

/* A thread the chat started, shown in the chat the way a spawned child session
   is: one line in the conversation's own voice, expandable for the task it was
   given and its latest step, with the way into it underneath. No card — the
   transcript already has a shape for "this chat started something". */

export function ThreadSpawnLine({
  call,
  result,
  sessionLive,
}: {
  call: TranscriptEvent;
  result?: TranscriptEvent;
  /** Whether the conversation that spawned it is still running. */
  sessionLive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dispatch = useStoreDispatch();
  const spawned = spawnedThread(result?.text);
  const row = useThreadRow(spawned?.id);
  const title = row?.title ?? spawned?.title ?? stringArg(call, 'title') ?? 'thread';
  // A turn interrupted mid-spawn never gets a result, so "starting" has to end
  // when the conversation does rather than shimmer for good.
  const starting = result === undefined && sessionLive;
  const live = row?.live === true || starting;
  const openThread = () => {
    if (spawned) dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'threads', threadId: spawned.id });
  };

  return (
    <div data-testid="thread-spawn-line">
      <div className="group flex items-center gap-1.5 text-[13px]">
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="-m-0.5 flex items-center rounded p-0.5"
          aria-label="Toggle thread detail"
          aria-expanded={open}
        >
          <Caret open={open} />
        </button>
        <span className={live ? 'shimmer-text font-medium' : 'text-droid-text-muted'}>
          {starting ? 'Starting thread' : 'Thread'}
        </span>
        <button
          type="button"
          disabled={!spawned}
          onClick={openThread}
          className="font-semibold text-droid-text underline-offset-2 hover:underline disabled:no-underline"
          title="Open this thread"
        >
          {title}
        </button>
        {row && !live && (
          <>
            <span className="min-w-0 truncate text-[12px] text-droid-text-muted">{row.detail}</span>
            <ActivityStatusGlyph status={row.status} />
          </>
        )}
      </div>
      <Expand open={open}>
        <SpawnDetail
          task={stringArg(call, 'prompt')}
          step={row?.detail}
          live={live}
          canOpen={Boolean(spawned)}
          onOpen={openThread}
        />
      </Expand>
    </div>
  );
}

/* What the line hides until asked: the task the thread was given, its own last
   step, and the way into it. */
function SpawnDetail({
  task,
  step,
  live,
  canOpen,
  onOpen,
}: {
  task: string | undefined;
  step: string | undefined;
  live: boolean;
  canOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="mt-2 pl-[18px]">
      {task !== undefined && (
        <div className="break-words text-[13px] leading-relaxed text-droid-text-muted/70">
          {task}
        </div>
      )}
      {step !== undefined && (
        <div
          className={`mt-1.5 break-words text-[13px] font-medium leading-relaxed ${
            live ? 'shimmer-text' : 'text-droid-text-secondary'
          }`}
        >
          {step}
        </div>
      )}
      <button
        type="button"
        disabled={!canOpen}
        onClick={onOpen}
        className="mt-2 inline-flex items-center gap-1 text-[12px] text-droid-text-muted transition-colors hover:text-droid-text disabled:hover:text-droid-text-muted"
      >
        Open thread
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The row the Threads panel shows for this thread, so both read the same. */
function useThreadRow(appSessionId: string | undefined) {
  const snapshot = useProjects();
  const state = useStoreSelector(
    (current) => ({
      activeAppSessionId: current.activeAppSessionId,
      sessions: current.sessions,
      pendingPermissions: current.pendingPermissions,
      pendingQuestions: current.pendingQuestions,
    }),
    shallowEqual,
  );
  const digests = useThreadDigests(appSessionId ? [appSessionId] : EMPTY_IDS);
  if (!appSessionId) return undefined;
  const rows = threadRows(projectForSession(snapshot.projects, state.activeAppSessionId), {
    sessions: state.sessions,
    attention: (id) => sessionAttention(id, state.pendingPermissions, state.pendingQuestions),
    digests,
  });
  return rows.find((item) => item.appSessionId === appSessionId);
}

function stringArg(call: TranscriptEvent, key: string): string | undefined {
  const value = toolArgString(call.toolArgs, key)?.trim();
  return value === '' ? undefined : value;
}

const EMPTY_IDS: string[] = [];
