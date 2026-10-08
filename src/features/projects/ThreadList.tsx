import { useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { SidebarSectionHeading } from '../../components/SidebarSectionHeading';
import { ProjectPlan } from './ProjectPlan';
import { ThreadRow } from './ThreadRow';
import { threadCounts, threadGroups, type ThreadRow as ThreadRowModel } from './threadBoard';
import type { ProjectDone, ProjectStep } from './types';
import { projectTimeline, threadGreeting } from './threadGreeting';

/* The Threads list: where the project stands, the project it belongs to and how
   long it has run, then what needs attention or is running now, then the plan,
   then the history. Sections fold on a heading that carries their count; every
   row carries the thread's own last step, never a status the app cannot back
   up. A long project gets a search box and starts with its history folded.

   Nothing here starts a thread. The chat that owns the project does that, with
   the settings it chooses, so this surface stays somewhere to read and steer
   from rather than a second place to launch work. */

// Projects past these sizes fold their history and offer search.
const HISTORY_FOLD = 10;
const SEARCH_FROM = 20;

export function ThreadList({
  rows,
  plan,
  title,
  cwd,
  startedAt,
  done,
  held,
  leadStopped = false,
  onResume,
  now,
  error,
  activeAppSessionId,
  onOpenThread,
}: {
  rows: readonly ThreadRowModel[];
  plan: readonly ProjectStep[];
  /** Left out where the page already names the project. */
  title?: string;
  cwd?: string;
  startedAt?: number;
  done?: ProjectDone;
  /** The project is paused, so nothing waiting will move on its own. */
  held: boolean;
  /** The user stopped the lead; its threads keep working and reports wait for it. */
  leadStopped?: boolean;
  onResume?: () => void;
  now: number;
  error: string;
  activeAppSessionId?: string | null;
  onOpenThread: (appSessionId: string) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  // A long history starts folded so what is happening now stays in view.
  const [folded, setFolded] = useState<ReadonlySet<string>>(
    () => new Set(rows.length > HISTORY_FOLD ? ['ready'] : []),
  );
  const [query, setQuery] = useState('');
  const toggle = (key: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => `${row.title} ${row.detail}`.toLowerCase().includes(needle))
    : rows;
  const groups = threadGroups(shown);
  const current = groups.filter((group) => group.key !== 'ready');
  const history = groups.filter((group) => group.key === 'ready');
  const counts = threadCounts(rows);
  const renderGroup = (group: (typeof groups)[number]) => {
    const open = !folded.has(group.key);
    return (
      <div key={group.key} className="pt-3">
        <motion.div layout={!reduceMotion}>
          <SidebarSectionHeading
            label={`${group.label} · ${String(group.rows.length)}`}
            open={open}
            onToggle={() => {
              toggle(group.key);
            }}
          />
        </motion.div>
        {open &&
          group.rows.map((row) => (
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
    );
  };
  const timeline = projectTimeline(startedAt, done, cwd, now);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-2 pt-5">
          <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-droid-text">
            {threadGreeting(rows, counts, done)}
          </h2>
          {title && (
            <p className="mt-2.5 truncate text-[15px] font-semibold leading-5 tracking-tight text-droid-text">
              {title}
            </p>
          )}
          {timeline && (
            <p className="mt-0.5 text-[12px] leading-5 text-droid-text-muted">{timeline}</p>
          )}
          {held ? (
            <div className="mt-2 flex items-center gap-3">
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-droid-text-secondary">
                Paused. Work and queued messages are kept.
              </p>
              {onResume && (
                <button
                  type="button"
                  onClick={onResume}
                  className="shrink-0 rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated"
                >
                  Resume
                </button>
              )}
            </div>
          ) : (
            leadStopped && (
              <p className="mt-1 text-[13px] leading-5 text-droid-text-secondary">
                Lead stopped. The team keeps working; reports wait until you message it.
              </p>
            )
          )}
          {done && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-droid-border px-3 py-2.5">
              <span className="mt-1 shrink-0">
                <ActivityStatusGlyph status="settled" />
              </span>
              <p className="min-w-0 text-[12px] leading-5 text-droid-text-secondary">
                {done.outcome}
              </p>
            </div>
          )}
        </div>

        {rows.length > SEARCH_FROM && (
          <div className="px-4 pb-1 pt-2">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search threads"
              aria-label="Search threads"
              className="w-full rounded-lg border border-droid-border bg-transparent px-2.5 py-1.5 text-[13px] text-droid-text placeholder:text-droid-text-muted focus:border-droid-border-hover focus:outline-none"
            />
          </div>
        )}

        <div className="px-2">
          <LayoutGroup>{current.map(renderGroup)}</LayoutGroup>
        </div>

        {!needle && (
          <ProjectPlan
            plan={plan}
            rows={rows}
            open={!folded.has('plan')}
            onToggle={() => {
              toggle('plan');
            }}
            onOpenThread={onOpenThread}
          />
        )}

        <div className="px-2 pb-3">
          <LayoutGroup>{history.map(renderGroup)}</LayoutGroup>
          {rows.length === 0 && plan.length === 0 && (
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
