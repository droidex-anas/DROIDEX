import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ChevronRight, Plus, Spinner } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { formatRelativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import { resolveNewChatCwd, workspaceName } from '../../lib/workspaces';
import { createProject, resumeProject } from './client';
import { NewProjectForm } from './NewProjectForm';
import { PaneTransition } from './PaneTransition';
import { ProjectThreads } from './ProjectThreads';
import { projectLead } from './threadBoard';
import { useProjectBoard, type ProjectBoardEntry } from './useProjectBoard';
import { useRelativeTimeNow } from './useRelativeTimeNow';
import type { ThreadInput } from './types';

/* Projects: every project, and one project at a time with the threads it is
   running. A project is one conversation that hands work to others, so this
   view answers two questions and no more — is anything waiting on me, and what
   is each project doing right now. Everything about a project lives here; the
   chat itself opens in the main pane when the user asks for it. */

export function ProjectsRoute() {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion() === true;
  const { entries, loading, error } = useProjectBoard();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const now = useRelativeTimeNow();
  // A new project follows the workspace a new chat would, so starting one from
  // the Projects tab lands in the folder the user is already working in.
  const cwd = useStoreSelector((state) =>
    resolveNewChatCwd(
      state.activeAppSessionId ? state.sessions[state.activeAppSessionId] : undefined,
      state.draftChat,
    ),
  );
  const open = entries.find((entry) => entry.project.id === openId);

  /* Opening a project is opening the conversation that leads it, with its
     threads already beside it: that pairing is the project, and a person should
     not have to reassemble it from two clicks. */
  function openLeadChat(appSessionId: string): void {
    dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
    dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'threads' });
  }

  function openChat(entry: ProjectBoardEntry): void {
    const lead = projectLead(entry.project);
    if (lead) openLeadChat(lead.appSessionId);
  }

  // A new project opens like any other new chat instead of leaving the user on a list.
  async function create(input: ThreadInput): Promise<void> {
    const started = await createProject(input);
    setCreating(false);
    if (started.appSessionId) openLeadChat(started.appSessionId);
    else setOpenId(started.projectId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-droid-bg text-droid-text">
      <div data-electron-drag-region className="h-9 shrink-0" />
      <PaneTransition open={Boolean(open)} reduceMotion={reduceMotion} viewKey={open?.project.id}>
        {open ? (
          <ProjectThreads
            entry={open}
            now={now}
            onBack={() => {
              setOpenId(null);
            }}
            onOpenChat={() => {
              openChat(open);
            }}
            onResume={() => {
              resumeProject(open.project.id).catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : String(error));
              });
            }}
            onOpenThread={(appSessionId) => {
              dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
            }}
          />
        ) : (
          <ProjectListView
            entries={entries}
            loading={loading}
            error={error ?? ''}
            now={now}
            creating={creating}
            cwd={cwd}
            onCreate={create}
            onToggleCreate={() => {
              setCreating((value) => !value);
            }}
            onOpen={setOpenId}
            onOpenChat={openChat}
          />
        )}
      </PaneTransition>
    </div>
  );
}

function ProjectListView({
  entries,
  loading,
  error,
  now,
  creating,
  cwd,
  onCreate,
  onToggleCreate,
  onOpen,
  onOpenChat,
}: {
  entries: ProjectBoardEntry[];
  loading: boolean;
  error: string;
  now: number;
  creating: boolean;
  cwd: string;
  onCreate: (input: ThreadInput) => Promise<void>;
  onToggleCreate: () => void;
  onOpen: (projectId: string) => void;
  onOpenChat: (entry: ProjectBoardEntry) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-4">
        <div className="flex items-center gap-3 pb-5">
          <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Projects</h1>
          <button
            type="button"
            onClick={onToggleCreate}
            className="flex items-center gap-1.5 rounded-xl bg-droid-active px-3 py-1.5 text-[13px] font-medium text-droid-text transition-colors hover:bg-droid-elevated"
          >
            <Plus className="h-3.5 w-3.5" />
            New project
          </button>
        </div>

        {creating && (
          <div className="mb-5">
            <NewProjectForm cwd={cwd} onSubmit={onCreate} onCancel={onToggleCreate} />
          </div>
        )}

        {entries.length === 0 && !creating ? (
          <Empty loading={loading} error={error} onCreate={onToggleCreate} />
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <ProjectRow
                key={entry.project.id}
                entry={entry}
                now={now}
                onOpenChat={() => {
                  onOpenChat(entry);
                }}
                onOpenDetails={() => {
                  onOpen(entry.project.id);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectRow({
  entry,
  now,
  onOpenChat,
  onOpenDetails,
}: {
  entry: ProjectBoardEntry;
  now: number;
  onOpenChat: () => void;
  onOpenDetails: () => void;
}) {
  const { project, pulse } = entry;
  const folder = project.cwd ? workspaceName(project.cwd) : '';
  return (
    <div
      data-testid="project-row"
      className="group flex items-center gap-2 rounded-2xl border border-droid-border bg-droid-surface/40 pr-2 transition-colors hover:border-droid-border-hover hover:bg-droid-elevated/40"
    >
      <button
        type="button"
        onClick={onOpenChat}
        title="Open this project’s chat and its threads"
        className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-5 py-4 text-left"
      >
        <span className="flex w-4 shrink-0 justify-center">
          <ActivityStatusGlyph status={pulse.attention > 0 ? 'input' : 'ready'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2.5">
            <span className="truncate text-[15px] font-semibold text-droid-text">
              {project.title}
            </span>
            {folder && <span className="truncate text-[12px] text-droid-text-muted">{folder}</span>}
          </span>
          <span className="mt-1 block truncate text-[13px] text-droid-text-secondary">
            {pulse.summary}
          </span>
        </span>
        {/* While it runs, the trailing slot carries the work instead of a time
            that would only tell the user how long ago it started. */}
        <span className="flex w-14 shrink-0 items-center justify-end">
          {pulse.live ? (
            <WorkingSpinner />
          ) : (
            <span className="text-[12px] tabular-nums text-droid-text-muted">
              {formatRelativeTime(pulse.updatedAt, now)}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenDetails}
        aria-label={`Open ${project.title} in Projects`}
        className="shrink-0 rounded-lg p-2 text-droid-text-muted opacity-0 transition-opacity hover:bg-droid-elevated hover:text-droid-text focus-visible:opacity-100 group-hover:opacity-100"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/** The app's own spinner, tinted to the accent so a running project reads at a glance. */
function WorkingSpinner() {
  return (
    <Spinner
      aria-label="working"
      className="h-4 w-4 text-droid-accent motion-safe:animate-spin-slow"
    />
  );
}

/* Three states, never mixed: the runtime could not answer, it has not answered
   yet, or it answered with nothing. A failure that read as "still loading" left
   the tab spinning with no way to learn why. */
function Empty({
  loading,
  error,
  onCreate,
}: {
  loading: boolean;
  error: string;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-droid-border px-6 py-10 text-center">
      <h2 className="text-[15px] font-medium">
        {error ? 'Projects could not be loaded' : loading ? 'Loading projects…' : 'No projects yet'}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-droid-text-muted">
        {error ||
          'A project is one conversation that leads the work. Give it a goal and it splits the parts that can run at once into threads — each its own chat, reporting back as it finishes.'}
      </p>
      {!loading && !error && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 rounded-xl bg-droid-text px-4 py-2 text-[13px] font-medium text-droid-bg transition-opacity hover:opacity-80"
        >
          Start a project
        </button>
      )}
    </div>
  );
}
