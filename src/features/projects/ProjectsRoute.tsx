import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Plus } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { formatRelativeTime } from '../../lib/time';
import { workspaceName } from '../../lib/workspaces';
import { createProject, pauseProject } from './client';
import { NewProjectForm } from './NewProjectForm';
import { ProjectThreads } from './ProjectThreads';
import { projectSession } from './sessions';
import { useProjectBoard, type ProjectBoardEntry } from './useProjectBoard';
import type { ThreadInput } from './types';

/* Projects: every project, and one project at a time with the threads it is
   running. A project is one conversation that hands work to others, so this
   view answers two questions and no more — is anything waiting on me, and what
   is each project doing right now. Everything about a project lives here; the
   chat itself opens in the main pane when the user asks for it. */

export function ProjectsRoute() {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion() === true;
  const { entries, loading } = useProjectBoard();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  const cwd = useStoreSelector(
    (state) => projectSession(state.sessions, state.activeAppSessionId)?.cwd ?? '',
  );
  const open = entries.find((entry) => entry.project.id === openId);

  function openChat(entry: ProjectBoardEntry): void {
    const main = entry.project.threads.find((thread) => !thread.ownerAppSessionId);
    if (main) dispatch({ type: 'SET_ACTIVE_SESSION', id: main.appSessionId });
  }

  async function create(input: ThreadInput): Promise<void> {
    const id = await createProject(input);
    setCreating(false);
    setOpenId(id);
  }

  const travel = reduceMotion ? 0 : 12;
  return (
    <div className="flex h-full min-h-0 flex-col bg-droid-bg text-droid-text">
      <div data-electron-drag-region className="h-9 shrink-0" />
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={open ? `project:${open.project.id}` : 'list'}
          initial={{ opacity: 0, x: open ? travel : -travel }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: open ? -travel : travel }}
          transition={{
            duration: reduceMotion ? 0 : INLINE_CARD_DURATION_S,
            ...(reduceMotion ? {} : { ease: INLINE_CARD_EASE }),
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
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
                void pauseProject(open.project.id, false, true);
              }}
              onOpenThread={(appSessionId) => {
                dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
              }}
            />
          ) : (
            <ProjectListView
              entries={entries}
              loading={loading}
              now={now}
              creating={creating}
              cwd={cwd}
              onCreate={create}
              onToggleCreate={() => {
                setCreating((value) => !value);
              }}
              onOpen={setOpenId}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ProjectListView({
  entries,
  loading,
  now,
  creating,
  cwd,
  onCreate,
  onToggleCreate,
  onOpen,
}: {
  entries: ProjectBoardEntry[];
  loading: boolean;
  now: number;
  creating: boolean;
  cwd: string;
  onCreate: (input: ThreadInput) => Promise<void>;
  onToggleCreate: () => void;
  onOpen: (projectId: string) => void;
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
          <Empty loading={loading} onCreate={onToggleCreate} />
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <ProjectRow
                key={entry.project.id}
                entry={entry}
                now={now}
                onOpen={() => {
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
  onOpen,
}: {
  entry: ProjectBoardEntry;
  now: number;
  onOpen: () => void;
}) {
  const { project, pulse } = entry;
  const folder = project.cwd ? workspaceName(project.cwd) : '';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="project-row"
      className="group flex items-center gap-4 rounded-2xl border border-droid-border bg-droid-surface/40 px-5 py-4 text-left transition-colors hover:border-droid-border-hover hover:bg-droid-elevated/40"
    >
      <span className="flex w-4 shrink-0 justify-center">
        {pulse.live ? (
          <span
            aria-label="working"
            className="h-3 w-3 rounded-full border-[1.5px] border-droid-text border-r-transparent motion-safe:animate-spin-slow"
          />
        ) : (
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              pulse.attention > 0 ? 'bg-droid-orange' : 'bg-droid-text-muted/50'
            }`}
          />
        )}
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
      <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-droid-text-muted">
        {formatRelativeTime(pulse.updatedAt, now)}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-droid-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function Empty({ loading, onCreate }: { loading: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-droid-border px-6 py-10 text-center">
      <h2 className="text-[15px] font-medium">
        {loading ? 'Loading projects…' : 'No projects yet'}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-droid-text-muted">
        A project is one conversation that leads the work. Give it a goal and it splits the parts
        that can run at once into threads — each its own chat, reporting back as it finishes.
      </p>
      {!loading && (
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
