import { useState } from 'react';
import { Plus, RefreshCw } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useActivityDigests } from '../../hooks/useActivityDigests';
import { sessionAttention } from '../../lib/sessionAttention';
import { formatRelativeTime } from '../../lib/time';
import { workspaceName } from '../../lib/workspaces';
import { createProject, refreshProjects, useProjects } from './client';
import { NewProjectForm } from './NewProjectForm';
import { projectSession } from './sessions';
import { threadRows, type ThreadRow } from './threadBoard';
import type { ProjectView, ThreadInput } from './types';

/* Projects home: every local project as one row that says what it is doing and
   whether anything is waiting on the user. Opening a row is ordinary navigation
   to that project's main conversation — its threads live in the chat's Threads
   panel, so this view stays a list rather than a second workspace. */

export function ProjectsRoute() {
  const snapshot = useProjects();
  const dispatch = useStoreDispatch();
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  const state = useStoreSelector(
    (current) => ({
      sessions: current.sessions,
      pendingPermissions: current.pendingPermissions,
      pendingQuestions: current.pendingQuestions,
      cwd: projectSession(current.sessions, current.activeAppSessionId)?.cwd ?? '',
    }),
    shallowEqual,
  );
  const digests = useActivityDigests(true);

  function openProject(project: ProjectView): void {
    const main = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (main) dispatch({ type: 'SET_ACTIVE_SESSION', id: main.appSessionId });
  }

  async function create(input: ThreadInput): Promise<void> {
    const id = await createProject(input);
    setCreating(false);
    const project = snapshot.projects.find((item) => item.id === id);
    if (project) openProject(project);
  }

  const rows = (project: ProjectView) =>
    threadRows(project, {
      sessions: state.sessions,
      attention: (id) => sessionAttention(id, state.pendingPermissions, state.pendingQuestions),
      digests,
    });

  return (
    <div className="flex h-full min-h-0 flex-col bg-droid-bg text-droid-text">
      <div data-electron-drag-region className="h-9 shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-4">
          <div className="flex items-center gap-3 pb-5">
            <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Projects</h1>
            <button
              type="button"
              onClick={() => {
                setCreating((open) => !open);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-droid-active px-3 py-1.5 text-[13px] font-medium text-droid-text transition-colors hover:bg-droid-elevated"
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </button>
          </div>

          {snapshot.error && (
            <div
              role="alert"
              className="mb-4 flex items-center gap-3 rounded-xl border border-droid-border px-4 py-3 text-[12px] text-droid-text-secondary"
            >
              <span className="flex-1">{snapshot.error}</span>
              <button
                type="button"
                onClick={refreshProjects}
                aria-label="Reload projects"
                className="rounded-lg p-1.5 hover:bg-droid-elevated"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {creating && (
            <div className="mb-5">
              <NewProjectForm
                cwd={state.cwd}
                onSubmit={create}
                onCancel={() => {
                  setCreating(false);
                }}
              />
            </div>
          )}

          {snapshot.projects.length === 0 && !creating ? (
            <Empty loading={snapshot.loading} />
          ) : (
            <div className="flex flex-col gap-2">
              {snapshot.projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  rows={rows(project)}
                  now={now}
                  onOpen={() => {
                    openProject(project);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  rows,
  now,
  onOpen,
}: {
  project: ProjectView;
  rows: ThreadRow[];
  now: number;
  onOpen: () => void;
}) {
  const waiting = rows.filter((row) => row.state === 'attention').length;
  const working = rows.filter((row) => row.state === 'working').length;
  const updatedAt = rows.reduce((newest, row) => Math.max(newest, row.updatedAt), 0);
  const folder = project.cwd ? workspaceName(project.cwd) : '';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="project-row"
      className="flex items-center gap-4 rounded-2xl border border-droid-border bg-droid-surface/40 px-5 py-4 text-left transition-colors hover:border-droid-border-hover hover:bg-droid-elevated/40"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2.5">
          <span className="truncate text-[15px] font-semibold text-droid-text">
            {project.title}
          </span>
          {folder && <span className="truncate text-[12px] text-droid-text-muted">{folder}</span>}
        </span>
        <span className="mt-1 block truncate text-[13px] text-droid-text-secondary">
          {summary(project, waiting, working, rows.length)}
        </span>
      </span>
      {project.paused && (
        <span className="shrink-0 rounded-full bg-droid-active/60 px-2.5 py-0.5 text-[12px] text-droid-text-muted">
          Paused
        </span>
      )}
      <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-droid-text-muted">
        {formatRelativeTime(updatedAt, now)}
      </span>
    </button>
  );
}

function summary(project: ProjectView, waiting: number, working: number, total: number): string {
  const parts: string[] = [];
  if (waiting > 0) parts.push(plural(waiting, 'thread needs you', 'threads need you'));
  if (working > 0) parts.push(plural(working, 'thread working', 'threads working'));
  if (parts.length === 0)
    parts.push(total === 0 ? 'No threads yet' : plural(total, 'thread settled', 'threads settled'));
  if (project.queued > 0) parts.push(`${String(project.queued)} queued`);
  return parts.join(' · ');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `One ${one}` : `${String(count)} ${many}`;
}

function Empty({ loading }: { loading: boolean }) {
  return (
    <div className="rounded-2xl border border-droid-border px-6 py-10 text-center">
      <h2 className="text-[15px] font-medium">
        {loading ? 'Loading projects…' : 'No projects yet'}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-droid-text-muted">
        A project is one conversation that can run others. Start it with a task, then ask it to
        spread the work across threads — each thread is its own chat you can open and steer.
      </p>
    </div>
  );
}
