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
  const isAlt =
    (row?.droidProfile ?? spawned?.droidProfile) === 'alt' ||
    (starting && stringArg(call, 'profile') === 'alt');
  // A fork copies a lead's transcript but not its place in the project, so its
  // Threads panel has nothing to show; from there a thread opens on its own.
  const sameProject = useStoreSelector((state) => {
    if (!spawned?.reportBack) return false;
    const project = projectForSession(state.projects, spawned.id);
    return (
      project !== undefined &&
      project === projectForSession(state.projects, state.activeAppSessionId)
    );
  });
  const openSpawned = () => {
    if (!spawned) return;
    if (sameProject) dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'threads', threadId: spawned.id });
    else dispatch({ type: 'SET_ACTIVE_SESSION', id: spawned.id });
  };
  const toggle = () => {
    setOpen((value) => !value);
  };

  return (
    <div data-testid="thread-spawn-line">
      <div className="group flex items-center gap-1.5 text-body">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={words.toggle}
          className={live ? 'shimmer-text font-medium' : 'text-muted'}
        >
          {starting ? words.starting : words.started}
        </button>
        <button
          type="button"
          disabled={!spawned}
          onClick={openSpawned}
          className="inline-link font-semibold text-primary"
          title={words.openTitle}
        >
          {title}
        </button>
        {isAlt && (
          <span className="shrink-0 text-caption text-muted" title="Alt Factory account">
            <span className="sr-only">Factory account: </span>Alt
          </span>
        )}
        {row && !live && (
          <>
            <span className="min-w-0 truncate text-caption text-muted">{row.detail}</span>
            <ActivityStatusGlyph status={row.status} />
          </>
        )}
        {/* The verb is the accessible toggle; the chevron repeats it for the pointer. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={toggle}
          className="-m-0.5 flex items-center rounded-xs p-0.5"
        >
          <Caret open={open} />
        </button>
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
    <div className="mt-2 pl-4">
      {task !== undefined && <div className="break-words text-body text-muted">{task}</div>}
      {step !== undefined && (
        <div
          className={`mt-1.5 break-words text-body font-medium ${
            live ? 'shimmer-text' : 'text-secondary'
          }`}
        >
          {step}
        </div>
      )}
      <button
        type="button"
        disabled={!canOpen}
        onClick={onOpen}
        className="mt-2 inline-flex items-center gap-1 text-label text-muted transition-colors hover:text-primary disabled:hover:text-muted"
      >
        {openLabel}
        <ChevronRight className="size-icon-sm" />
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
