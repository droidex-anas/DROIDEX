import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useActivityDigests } from '../../hooks/useActivityDigests';
import { sessionAttention } from '../../lib/sessionAttention';
import type { TranscriptEvent } from '../../types/bridge';
import { useProjects } from './client';
import { projectForSession, threadRows, type ThreadRow } from './threadBoard';
import { spawnedThread } from './threadToolNames';

/* A thread the chat started, shown in the chat where the tool call was made:
   its name, and its own live step underneath — the same line the Threads panel
   shows, because it is the same row. Clicking it opens that thread in the
   panel, so reading a thread never takes the chat away from the user. */

export function ThreadSpawnRow({
  call,
  result,
}: {
  call: TranscriptEvent;
  result?: TranscriptEvent;
}) {
  const dispatch = useStoreDispatch();
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
  const digests = useActivityDigests(true);
  const spawned = spawnedThread(result?.text);
  const rows = threadRows(projectForSession(snapshot.projects, state.activeAppSessionId), {
    sessions: state.sessions,
    attention: (id) => sessionAttention(id, state.pendingPermissions, state.pendingQuestions),
    digests,
  });
  const row = spawned ? rows.find((item) => item.appSessionId === spawned.id) : undefined;
  const title = row?.title ?? spawned?.title ?? requestedTitle(call) ?? 'Thread';
  const detail = row?.detail ?? (result ? 'Started' : 'Starting…');
  const starting = !result;
  const tone = dotTone(row?.state, starting);

  return (
    <button
      type="button"
      data-testid="thread-spawn-row"
      disabled={!spawned}
      onClick={() => {
        if (spawned) dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'threads', threadId: spawned.id });
      }}
      className="flex w-full items-center gap-3 rounded-2xl border border-droid-border bg-droid-surface/35 px-4 py-3 text-left transition-colors hover:border-droid-border-hover hover:bg-droid-elevated/40 disabled:hover:border-droid-border disabled:hover:bg-droid-surface/35"
    >
      <span
        aria-hidden="true"
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${tone} ${
          row?.live === true || starting ? 'motion-safe:animate-pulse' : ''
        }`}
      />
      <span className="shrink-0 text-[13px] font-medium text-droid-text">{title}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[12px] ${
          row?.live === true ? 'shimmer-text font-medium' : 'text-droid-text-muted'
        }`}
      >
        {detail}
      </span>
    </button>
  );
}

function dotTone(state: ThreadRow['state'] | undefined, starting: boolean): string {
  if (state === 'attention') return 'bg-droid-orange';
  if (state === 'working' || starting) return 'bg-droid-green';
  return 'bg-droid-text-muted/60';
}

function requestedTitle(call: TranscriptEvent): string | undefined {
  const args: unknown = call.toolArgs;
  if (typeof args !== 'object' || args === null) return undefined;
  const title: unknown = (args as Record<string, unknown>).title;
  return typeof title === 'string' && title.trim() ? title : undefined;
}
