import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ThreadRow } from './ThreadRow';
import { threadCounts, threadGroups, type ThreadRow as ThreadRowModel } from './threadBoard';
import { threadGreeting, threadStatusLine } from './threadGreeting';

/* The Threads list: the panel's own line, the facts under it, then the threads
   grouped the way the inbox groups chats. Every row carries the thread's own
   last step, never a status the app cannot back up.

   Nothing here starts a thread. The chat that owns the project does that, with
   the settings it chooses, so this surface stays somewhere to read and steer
   from rather than a second place to launch work. */

export function ThreadList({
  rows,
  subtitle,
  now,
  error,
  activeAppSessionId,
  onOpenThread,
}: {
  rows: readonly ThreadRowModel[];
  subtitle: string;
  now: number;
  error: string;
  activeAppSessionId?: string | null;
  onOpenThread: (appSessionId: string) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const groups = threadGroups(rows);
  const counts = threadCounts(rows);
  const status = threadStatusLine(counts);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-3 pt-5">
          <h2 className="text-[21px] font-semibold leading-tight tracking-tight text-droid-text">
            {threadGreeting(rows, counts, now)}
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-droid-text-secondary">
            {status || 'Nothing running.'}
          </p>
          <p className="mt-0.5 text-[12px] leading-5 text-droid-text-muted">{subtitle}</p>
        </div>

        <div className="px-2 pb-3">
          <LayoutGroup>
            {groups.map((group) => (
              <div key={group.key}>
                <motion.div
                  layout={!reduceMotion}
                  className="px-3 pb-1.5 pt-4 text-[13px] font-medium text-droid-text-muted"
                >
                  {group.label} · {group.rows.length}
                </motion.div>
                {group.rows.map((row) => (
                  <ThreadRow
                    key={row.appSessionId}
                    row={row}
                    now={now}
                    active={row.appSessionId === activeAppSessionId}
                    reduceMotion={reduceMotion}
                    onOpen={onOpenThread}
                  />
                ))}
              </div>
            ))}
          </LayoutGroup>
          {rows.length === 0 && (
            <p className="px-3 py-2 text-[13px] leading-5 text-droid-text-muted">
              This project has not started any threads. Tell its chat what to run in parallel and it
              will open them here.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-t border-droid-border/70 px-4 py-3 text-[12px] leading-5 text-droid-text-secondary"
        >
          {error}
        </p>
      )}
    </div>
  );
}
