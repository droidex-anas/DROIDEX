import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, CornerDownRight, GitBranch, Pause, Play, Plus } from 'lucide-react';
import ChatView from '../../components/ChatView';
import PromptInput from '../../components/PromptInput';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { PROVIDER_LABELS } from '../providers/providerIdentity';
import { pauseProject, useProjects } from './client';
import NewProject from './NewProject';

export default function ProjectsRoute() {
  const { projects, loading, error: loadError } = useProjects();
  const dispatch = useStoreDispatch();
  const state = useStoreSelector(
    (current) => ({
      activeId: current.activeAppSessionId,
      sessions: current.sessions,
      permissions: current.pendingPermissions,
      questions: current.pendingQuestions,
      cwd:
        current.draftChat?.cwd ??
        (current.activeAppSessionId ? current.sessions[current.activeAppSessionId]?.cwd : '') ??
        '',
    }),
    shallowEqual,
  );
  const [page, setPage] = useState('list');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const tabs = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const project = projects.find((item) => item.id === page);
  const main = project?.threads.find((thread) => !thread.ownerAppSessionId);
  const selected = project?.threads.find((thread) => thread.appSessionId === state.activeId);

  useEffect(() => {
    if (project && main && !selected)
      dispatch({ type: 'OPEN_PROJECTS', appSessionId: main.appSessionId });
  }, [project?.id, main?.appSessionId, selected?.appSessionId, dispatch]);

  function moveTab(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = Array.from(
      tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const current = buttons.findIndex((button) => button === document.activeElement);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
    else return;
    event.preventDefault();
    buttons.at(next)?.focus();
    buttons.at(next)?.click();
  }

  async function togglePause(): Promise<void> {
    if (!project || pending) return;
    setPending(true);
    setError('');
    try {
      await pauseProject(project.id, !project.paused, project.uncertain > 0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  const buttonClass =
    'flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-droid-text-secondary transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted disabled:opacity-40';
  const alert = error || loadError || project?.error;
  return (
    <section
      data-testid="projects-view"
      className="flex min-h-0 flex-1 flex-col overflow-hidden text-droid-text"
    >
      <div data-electron-drag-region className="h-9 shrink-0" />
      <header className="flex shrink-0 items-center gap-2 px-4 py-2">
        {page !== 'list' && (
          <button
            aria-label="Back to projects"
            onClick={() => {
              setPage('list');
              setError('');
            }}
            className={buttonClass}
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <GitBranch size={16} className="text-droid-text-muted" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {project?.title ?? 'Projects'}
        </h1>
        {project ? (
          <>
            <span
              className="hidden text-xs text-droid-text-muted sm:inline"
              title="This is a wake allowance, not a token or spending limit."
            >
              {project.wakesLeft} wakes left
            </span>
            <button
              disabled={pending}
              onClick={() => void togglePause()}
              className={buttonClass}
              title="Pause prevents new automatic turns. Existing turns can finish."
            >
              {project.paused ? <Play size={14} /> : <Pause size={14} />}
              {project.paused
                ? project.uncertain
                  ? 'Resume without replay'
                  : 'Resume coordination'
                : 'Pause coordination'}
            </button>
          </>
        ) : (
          <button onClick={() => setPage('new')} className={buttonClass}>
            <Plus size={14} />
            New project
          </button>
        )}
      </header>
      {alert && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-xl border border-droid-border bg-droid-elevated px-3 py-2 text-xs text-droid-text-secondary"
        >
          {alert}
        </div>
      )}
      {project?.uncertain ? (
        <p className="mx-4 mb-2 text-xs leading-relaxed text-droid-text-muted">
          A previous wake may already have been sent. Review thread history before resuming; that
          wake will not be replayed.
        </p>
      ) : null}
      {project ? (
        <>
          <div
            ref={tabs}
            role="tablist"
            aria-label="Project threads"
            onKeyDown={moveTab}
            className="mx-4 mb-2 flex shrink-0 gap-1 overflow-x-auto rounded-2xl bg-droid-bg/50 p-1"
          >
            {project.threads.map((thread) => {
              const session = state.sessions[thread.appSessionId];
              const active = thread.appSessionId === selected?.appSessionId;
              const owner = project.threads.find(
                (item) => item.appSessionId === thread.ownerAppSessionId,
              );
              const needsUser = Boolean(
                state.permissions[thread.appSessionId] || state.questions[thread.appSessionId],
              );
              const status = needsUser
                ? 'Needs you'
                : thread.waiting
                  ? 'Waiting for owner'
                  : session?.streaming
                    ? 'Working'
                    : session?.phase === 'failed'
                      ? 'Failed'
                      : 'Idle';
              return (
                <button
                  key={thread.appSessionId}
                  id={`project-tab-${thread.appSessionId}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls="project-thread-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() =>
                    dispatch({ type: 'OPEN_PROJECTS', appSessionId: thread.appSessionId })
                  }
                  title={`${owner ? `From ${owner.title}` : 'Main thread'}${session ? ` · ${PROVIDER_LABELS[session.provider]} · ${session.modelId ?? 'default model'} · ${session.reasoningEffort ?? 'default reasoning'} · ${session.autonomy} autonomy` : ''}`}
                  className="relative flex max-w-[240px] shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-droid-elevated/50 focus-visible:ring-2 focus-visible:ring-droid-text-muted"
                >
                  {active && (
                    <motion.span
                      layoutId={`project-active-${project.id}`}
                      className="absolute inset-0 rounded-xl bg-droid-elevated shadow-sm"
                      transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
                    />
                  )}
                  <span className="relative text-droid-text-muted">
                    {owner ? <CornerDownRight size={14} /> : <GitBranch size={14} />}
                  </span>
                  <span className="relative min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {owner ? thread.title : 'Main'}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-droid-text-muted">
                      {session ? `${PROVIDER_LABELS[session.provider]} · ` : ''}
                      {status}
                    </span>
                  </span>
                </button>
              );
            })}
            {project.launching > 0 && (
              <span role="status" className="self-center px-3 text-xs text-droid-text-muted">
                Starting thread…
              </span>
            )}
          </div>
          {project.paused && (
            <p className="mx-5 mb-2 text-[11px] text-droid-text-muted">
              Coordination paused. Current turns can finish; {project.queued} messages are queued.
            </p>
          )}
          <div
            id="project-thread-panel"
            role="tabpanel"
            aria-labelledby={selected ? `project-tab-${selected.appSessionId}` : undefined}
            className="flex min-h-0 flex-1 flex-col"
          >
            {selected ? (
              <>
                <ChatView />
                <PromptInput />
              </>
            ) : (
              <p role="status" className="p-6 text-sm text-droid-text-muted">
                Opening main thread…
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p role="status" className="p-8 text-sm text-droid-text-muted">
              Connecting to local Projects…
            </p>
          ) : page === 'new' || projects.length === 0 ? (
            <NewProject cwd={state.cwd} onCreated={setPage} />
          ) : (
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="mx-auto grid max-w-4xl grid-cols-1 gap-3 px-6 py-5 md:grid-cols-2"
            >
              {projects.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setPage(item.id);
                    setError('');
                  }}
                  className="rounded-2xl border border-droid-border bg-droid-bg/30 p-5 text-left transition-colors hover:bg-droid-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted"
                >
                  <div className="flex items-center gap-2">
                    <GitBranch size={16} className="text-droid-text-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="text-[10px] text-droid-text-muted">
                      {item.paused ? 'Paused' : 'Watching'}
                    </span>
                  </div>
                  <p className="mt-4 text-xs text-droid-text-muted">
                    {item.threads.length} {item.threads.length === 1 ? 'thread' : 'threads'} ·{' '}
                    {item.queued} queued{item.launching ? ' · Starting…' : ''}
                  </p>
                  {item.error && (
                    <p className="mt-2 line-clamp-2 text-xs text-droid-text-secondary">
                      {item.error}
                    </p>
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </div>
      )}
    </section>
  );
}
