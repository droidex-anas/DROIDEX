import { useMemo } from 'react';
import { HoverTooltip } from '../../components/HoverTooltip';
import { useStoreSelector } from '../../hooks/useStore';
import { sessionIsLive } from '../../lib/sessions';
import { useProjects } from './client';
import { plural } from './threadGreeting';

/* Beside the last reply of a chat that ended its turn while its threads work:
   it is asleep on purpose, waiting for their reports, not stuck. Names the
   threads on hover. Nothing shows once none of them is working. */
export function ThreadsWaiting({ appSessionId }: { appSessionId: string }) {
  const { projects } = useProjects();
  const threads = useMemo(
    () =>
      projects
        .find((project) => project.threads.some((thread) => thread.appSessionId === appSessionId))
        ?.threads.filter((thread) => thread.ownerAppSessionId === appSessionId) ?? [],
    [projects, appSessionId],
  );
  // Joined, so the selector returns a value that compares equal while nothing changed.
  const working = useStoreSelector((state) =>
    threads
      .filter((thread) => {
        const session = Object.hasOwn(state.sessions, thread.appSessionId)
          ? state.sessions[thread.appSessionId]
          : undefined;
        return session !== undefined && sessionIsLive(session);
      })
      .map((thread) => thread.title)
      .join('\n'),
  );
  if (!working) return null;
  const names = working.split('\n');
  return (
    <HoverTooltip label={names.join(', ')}>
      <span
        data-testid="threads-waiting"
        className="ml-1.5 flex items-center gap-1.5 px-1 text-[12px] font-medium"
      >
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full border-[1.5px] border-droid-text-muted border-r-transparent motion-safe:animate-spin-slow"
        />
        <span className="shimmer-text shimmer-slow">
          Waiting for {plural(names.length, 'thread', 'threads')}
        </span>
      </span>
    </HoverTooltip>
  );
}
