import { useMemo, useState } from 'react';
import { ChevronRight } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { Caret, Expand } from '../../components/transcript/primitives';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { projectForSession } from '../../lib/projectThreads';
import { toolArgString } from '../../lib/tools';
import type { TranscriptEvent } from '../../types/bridge';
import { threadRows, type ThreadRow } from './threadBoard';
import { spawnedThread, type SpawnedChat } from './threadToolNames';
import { useThreadSignals } from './useProjectBoard';

/* A thread the chat started, shown in the chat the way a spawned child session
   is: one line in the conversation's own voice, expandable for the task it was
   given and its latest step, with the way into it underneath. No card: the
   transcript already has a shape for "this chat started something". A chat
   started with reportBack false reads the same way, but it is an ordinary
   sidebar chat, so it has no thread row to follow and opens as the main chat. */

const WORDS = {
  thread: {
    starting: 'Starting thread',
    started: 'Thread',
    open: 'Open thread',
    openTitle: 'Open this thread',
    toggle: 'Toggle thread detail',
  },
  chat: {
    starting: 'Starting chat',
    started: 'Chat',
    open: 'Open chat',
    openTitle: 'Open this chat',
    toggle: 'Toggle chat detail',
  },
} as const;

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
  const kind = spawnKind(call, spawned);
  const words = WORDS[kind];
  const row = useThreadRow(spawned);
  const title = row?.title ?? spawned?.title ?? stringArg(call, 'title') ?? words.started;
  // A turn interrupted mid-spawn never gets a result, so "starting" has to end
  // when the conversation does rather than shimmer for good.
  const starting = result === undefined && sessionLive;
  const live = row?.live === true || starting;
  const openSpawned = () => {
    if (!spawned) return;
    if (spawned.reportBack)
      dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'threads', threadId: spawned.id });
    else dispatch({ type: 'SET_ACTIVE_SESSION', id: spawned.id });
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
          aria-label={words.toggle}
          aria-expanded={open}
        >
          <Caret open={open} />
        </button>
        <span className={live ? 'shimmer-text font-medium' : 'text-droid-text-muted'}>
          {starting ? words.starting : words.started}
        </span>
        <button
          type="button"
          disabled={!spawned}
          onClick={openSpawned}
          className="font-semibold text-droid-text underline-offset-2 hover:underline disabled:no-underline"
          title={words.openTitle}
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
          openLabel={words.open}
          onOpen={openSpawned}
        />
      </Expand>
    </div>
  );
}

/* What the line hides until asked: the task it was given, a thread's own last
   step, and the way into it. */
function SpawnDetail({
  task,
  step,
  live,
  canOpen,
  openLabel,
  onOpen,
}: {
  task: string | undefined;
  step: string | undefined;
  live: boolean;
  canOpen: boolean;
  openLabel: string;
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
        {openLabel}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const NO_THREADS: readonly string[] = [];

/* The row the Threads panel shows for this thread, so both read the same. It
   reads only this thread's own digest: the line sits in the chat that spawned
   it, and a board-wide read would redraw it on every token that chat streams.
   A sidebar chat has no row, so it reads nothing. */
function useThreadRow(spawned: SpawnedChat | null): ThreadRow | undefined {
  const appSessionId = spawned?.reportBack ? spawned.id : undefined;
  const project = useStoreSelector((state) => projectForSession(state.projects, appSessionId));
  const signals = useThreadSignals(
    useMemo(() => (appSessionId ? [appSessionId] : NO_THREADS), [appSessionId]),
  );
  return useMemo(
    () => project && threadRows(project, signals).find((row) => row.appSessionId === appSessionId),
    [project, signals, appSessionId],
  );
}

/* Until the spawn settles, the call's own reportBack argument says which kind
   it starts. */
function spawnKind(call: TranscriptEvent, spawned: SpawnedChat | null): keyof typeof WORDS {
  if (spawned) return spawned.reportBack ? 'thread' : 'chat';
  const args = call.toolArgs;
  const asksForChat =
    typeof args === 'object' && args !== null && 'reportBack' in args && args.reportBack === false;
  return asksForChat ? 'chat' : 'thread';
}

function stringArg(call: TranscriptEvent, key: string): string | undefined {
  const value = toolArgString(call.toolArgs, key)?.trim();
  return value === '' ? undefined : value;
}
