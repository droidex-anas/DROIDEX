import { useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGroup, useReducedMotion } from 'framer-motion';
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
   up. A long project gets a search box and starts with its history folded,
   and only the entries near the viewport are mounted, so a project with
   hundreds of threads scrolls like one with ten.

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
  uncertain = 0,
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
  /** Messages that may already have reached their thread; Resume does not resend them. */
  uncertain?: number;
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
  const timeline = projectTimeline(startedAt, done, cwd, now);

  // One flat list of everything the panel shows, so a single virtualizer can
  // mount only what is near the viewport.
  const entries: { key: string; node: ReactNode }[] = [];
  const addGroup = (group: (typeof groups)[number]) => {
    const open = !folded.has(group.key);
    entries.push({
      key: `group:${group.key}`,
      node: (
        <div className="px-2 pt-3">
          <SidebarSectionHeading
            label={`${group.label} · ${String(group.rows.length)}`}
            open={open}
            onToggle={() => {
              toggle(group.key);
            }}
          />
        </div>
      ),
    });
    if (!open) return;
    for (const row of group.rows)
      entries.push({
        key: row.appSessionId,
        node: (
          <div className="px-2">
            <ThreadRow
              row={row}
              now={now}
              active={row.appSessionId === activeAppSessionId}
              reduceMotion={reduceMotion}
              onOpen={onOpenThread}
            />
          </div>
        ),
      });
  };

  entries.push({
    key: 'head',
    node: (
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
              {uncertain > 0
                ? 'A message may already have reached its thread before DROIDEX stopped. Resuming does not send it again.'
                : 'Paused. Work and queued messages are kept.'}
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
    ),
  });
  if (rows.length > SEARCH_FROM)
    entries.push({
      key: 'search',
      node: (
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
      ),
    });
  current.forEach(addGroup);
  if (!needle)
    entries.push({
      key: 'plan',
      node: (
        <ProjectPlan
          plan={plan}
          rows={rows}
          open={!folded.has('plan')}
          onToggle={() => {
            toggle('plan');
          }}
          onOpenThread={onOpenThread}
        />
      ),
    });
  history.forEach(addGroup);
  if (rows.length === 0 && plan.length === 0)
    entries.push({
      key: 'empty',
      node: (
        <p className="px-5 py-2 text-[13px] leading-5 text-droid-text-muted">
          This project has not started any threads. Tell its chat what to run in parallel and it
          will open them here.
        </p>
      ),
    });

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => entries[index]?.key ?? index,
    estimateSize: () => 56,
    overscan: 8,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-3">
        <LayoutGroup>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${String(item.start)}px)` }}
              >
                {entries[item.index]?.node}
              </div>
            ))}
          </div>
        </LayoutGroup>
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
