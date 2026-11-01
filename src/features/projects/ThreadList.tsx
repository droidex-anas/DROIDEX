import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGroup, useReducedMotion } from 'framer-motion';
import { ListTodo, MessageSquareText, type IconComponent } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { SidebarSectionHeading } from '../../components/SidebarSectionHeading';
import { Button } from '../../components/ui/Button';
import { PlanMeter, ProjectPlan } from './ProjectPlan';
import { AttentionThreadRow, ThreadRow } from './ThreadRow';
import { finishedSteps, threadGroups, type ThreadRow as ThreadRowModel } from './threadBoard';
import type { ProjectDone, ProjectStep } from './types';
import { projectTimeline } from './threadGreeting';

/* The Threads list: the project, how long it has run and how far its plan has
   come, then two views of it. Threads leads with what needs the user, on a
   card with the step that answers it, then what is running, then the history.
   Plan lists the lead's steps. Sections fold on a heading; every row carries
   the thread's own last step, never a status the app cannot back up. A long
   project gets a search box and starts with its history folded, and only the
   entries near the viewport are mounted, so a project with hundreds of
   threads scrolls like one with ten.

   Nothing here starts a thread. The chat that owns the project does that, with
   the settings it chooses, so this surface stays somewhere to read and steer
   from rather than a second place to launch work. */

export type ThreadListView = 'threads' | 'plan';

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
  view,
  onViewChange,
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
  /** Kept by the owner, so returning from an opened thread lands on the same view. */
  view: ThreadListView;
  onViewChange: (view: ThreadListView) => void;
  onOpenThread: (appSessionId: string) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const tabsId = useId();
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
  const hasPlan = plan.length > 0;
  const showPlan = hasPlan && view === 'plan';
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => `${row.title} ${row.detail}`.toLowerCase().includes(needle))
    : rows;
  const groups = threadGroups(shown);
  const attention = groups.find((group) => group.key === 'attention');
  const current = groups.filter((group) => group.key !== 'attention' && group.key !== 'ready');
  const history = groups.filter((group) => group.key === 'ready');
  const timeline = projectTimeline(startedAt, done, cwd, now);

  // One flat list of everything the active view shows, so a single
  // virtualizer can mount only what is near the viewport.
  const entries: { key: string; node: ReactNode }[] = [];
  const addGroup = (group: (typeof groups)[number]) => {
    const open = !folded.has(group.key);
    entries.push({
      key: `group:${group.key}`,
      node: (
        <div className="pl-2 pr-2.5 pt-3">
          <SidebarSectionHeading
            label={group.label}
            open={open}
            onToggle={() => {
              toggle(group.key);
            }}
            action={
              <span className="w-7 shrink-0 text-right text-caption tabular-nums text-muted">
                {group.rows.length}
              </span>
            }
          />
        </div>
      ),
    });
    if (!open) return;
    for (const row of group.rows)
      entries.push({
        key: row.appSessionId,
        node: (
          <div className="px-3">
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

  if (showPlan) {
    entries.push({
      key: 'plan',
      node: <ProjectPlan plan={plan} rows={rows} onOpenThread={onOpenThread} />,
    });
  } else {
    if (rows.length > SEARCH_FROM)
      entries.push({
        key: 'search',
        node: (
          <div className="px-3 pb-1 pt-2">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search threads"
              aria-label="Search threads"
              className="w-full rounded-md bg-field px-2 py-1.5 text-body text-primary outline-none placeholder:text-muted"
            />
          </div>
        ),
      });
    if (attention)
      entries.push({
        key: 'attention',
        node: (
          <AttentionCard
            label={attention.label}
            rows={attention.rows}
            activeAppSessionId={activeAppSessionId}
            reduceMotion={reduceMotion}
            onOpenThread={onOpenThread}
          />
        ),
      });
    current.forEach(addGroup);
    history.forEach(addGroup);
    if (rows.length === 0)
      entries.push({
        key: 'empty',
        node: (
          <p className="px-5 py-2 text-body text-muted">
            This project has not started any threads. Tell its chat what to run in parallel and it
            will open them here.
          </p>
        ),
      });
  }

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
      <ProjectSummary title={title} timeline={timeline} plan={plan}>
        <ProjectNotice
          held={held}
          uncertain={uncertain}
          leadStopped={leadStopped}
          done={done}
          onResume={onResume}
        />
      </ProjectSummary>
      {hasPlan && (
        <ViewTabs
          id={tabsId}
          view={view}
          threadCount={rows.length}
          planLabel={`${String(finishedSteps(plan))}/${String(plan.length)}`}
          onViewChange={onViewChange}
        />
      )}
      <div
        ref={scrollRef}
        id={hasPlan ? `${tabsId}-panel` : undefined}
        role={hasPlan ? 'tabpanel' : undefined}
        aria-labelledby={hasPlan ? `${tabsId}-${view}` : undefined}
        className="min-h-0 flex-1 overflow-y-auto pb-3"
      >
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
        <p role="alert" className="shrink-0 bg-danger-soft px-5 py-3 text-body text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ProjectSummary({
  title,
  timeline,
  plan,
  children,
}: {
  title: string | undefined;
  timeline: string;
  plan: readonly ProjectStep[];
  children: ReactNode;
}) {
  return (
    <div className="shrink-0 px-5 pt-4 empty:hidden">
      {title && <h2 className="truncate text-subheading text-primary">{title}</h2>}
      {timeline && <p className={`text-label text-muted ${title ? 'mt-1' : ''}`}>{timeline}</p>}
      {plan.length > 0 && <PlanMeter plan={plan} />}
      {children}
    </div>
  );
}

function ProjectNotice({
  held,
  uncertain,
  leadStopped,
  done,
  onResume,
}: {
  held: boolean;
  uncertain: number;
  leadStopped: boolean;
  done: ProjectDone | undefined;
  onResume: (() => void) | undefined;
}) {
  return (
    <>
      {held ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-body text-secondary">
            {uncertain > 0
              ? 'A message may already have reached its thread before DROIDEX stopped. Resuming does not send it again.'
              : 'Paused. Work and queued messages are kept.'}
          </p>
          {onResume && (
            <Button variant="secondary" size="sm" onClick={onResume}>
              Resume
            </Button>
          )}
        </div>
      ) : (
        leadStopped && (
          <p className="mt-3 text-body text-secondary">
            Lead stopped. The team keeps working; reports wait until you message it.
          </p>
        )
      )}
      {done && (
        // Pulled into the row gutter so its mark sits on the panel's 20px edge.
        <div className="-mx-2 mt-3 flex items-start gap-2.5 rounded-lg bg-surface px-2 py-2.5">
          <span className="mt-0.5 shrink-0">
            <ActivityStatusGlyph status="settled" />
          </span>
          <p className="min-w-0 text-body text-secondary">{done.outcome}</p>
        </div>
      )}
    </>
  );
}

const VIEW_LABELS: Record<ThreadListView, string> = { threads: 'Threads', plan: 'Plan' };
const VIEW_ICONS: Record<ThreadListView, IconComponent> = {
  threads: MessageSquareText,
  plan: ListTodo,
};
const VIEWS: readonly ThreadListView[] = ['threads', 'plan'];

/* Two tab chips in the shape the utility pane's own tabs use, so the Plan reads
   as a place to go rather than a figure in a status bar. */
function ViewTabs({
  id,
  view,
  threadCount,
  planLabel,
  onViewChange,
}: {
  /** Prefix for the tab ids and the panel id they control. */
  id: string;
  view: ThreadListView;
  threadCount: number;
  planLabel: string;
  onViewChange: (view: ThreadListView) => void;
}) {
  // The tablist is one tab stop; the arrows switch tabs, as WAI-ARIA tabs do.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = view === 'threads' ? 'plan' : 'threads';
    onViewChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Project views"
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-3"
    >
      {VIEWS.map((option) => {
        const selected = view === option;
        const Icon = VIEW_ICONS[option];
        return (
          <button
            key={option}
            id={`${id}-${option}`}
            type="button"
            role="tab"
            data-view={option}
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onViewChange(option);
            }}
            className={`flex h-control-sm select-none items-center gap-1.5 rounded-md px-2 text-label transition-colors ${
              selected
                ? 'bg-active text-primary'
                : 'text-muted hover:bg-elevated hover:text-primary'
            }`}
          >
            <Icon className="size-icon-sm shrink-0" aria-hidden="true" />
            <span>{VIEW_LABELS[option]}</span>
            <span className="text-caption tabular-nums text-muted">
              {option === 'threads' ? threadCount : planLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* What waits on the user, lifted onto a surface card. The first row's step is
   the panel's one primary action. */
function AttentionCard({
  label,
  rows,
  activeAppSessionId,
  reduceMotion,
  onOpenThread,
}: {
  label: string;
  rows: readonly ThreadRowModel[];
  activeAppSessionId: string | null | undefined;
  reduceMotion: boolean;
  onOpenThread: (appSessionId: string) => void;
}) {
  return (
    <section aria-label={label} className="px-3 pt-3">
      <div className="rounded-lg bg-surface p-1">
        <h3 className="flex h-7 items-center px-1 text-label text-secondary">
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="w-7 shrink-0 text-right text-caption tabular-nums text-muted">
            {rows.length}
          </span>
        </h3>
        {rows.map((row, index) => (
          <AttentionThreadRow
            key={row.appSessionId}
            row={row}
            primary={index === 0}
            active={row.appSessionId === activeAppSessionId}
            reduceMotion={reduceMotion}
            onOpen={onOpenThread}
          />
        ))}
      </div>
    </section>
  );
}
