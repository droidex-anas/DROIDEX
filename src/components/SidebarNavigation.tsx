import { useEffect, useRef } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { bindLazySurfaceIntent } from '../lib/chunkPreloader';
import { isEmbedded } from '../lib/embed';
import { resolvePrWorkspaceCwd } from '../features/pull-requests/lib/prWorkspaceCwd';
import { GitPullRequestIcon } from './environment/GithubIcons';
import { Clock, MessageCirclePlus } from '@droidex/icons';
import { useProjectBoard } from '../features/projects/useProjectBoard';

export function SidebarNavigation() {
  const dispatch = useStoreDispatch();
  const board = useProjectBoard();
  const state = useStoreSelector((current) => {
    const activeSession = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : null;
    return {
      activeSession,
      mainView: current.mainView,
      prWorkspaceCwd: current.prWorkspaceCwd,
      workspaceCwds: current.workspaceCwds,
    };
  }, shallowEqual);
  const automationsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => bindLazySurfaceIntent('automations', automationsButtonRef.current), []);

  if (isEmbedded()) return null;

  return (
    <>
      <button
        data-testid="pull-requests-nav"
        onClick={() => {
          const cwd = resolvePrWorkspaceCwd({
            boundCwd: state.prWorkspaceCwd,
            activeCwd: state.activeSession?.cwd,
            workspaceKind: state.activeSession?.workspaceKind,
            workspaceCwds: state.workspaceCwds,
          });
          dispatch({ type: 'OPEN_PULL_REQUESTS', cwd });
        }}
        className={`group mt-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium text-droid-text transition-colors ${
          state.mainView === 'pull-requests' ? 'bg-droid-active' : ''
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
            state.mainView === 'pull-requests'
              ? 'text-droid-text'
              : 'text-droid-text-secondary group-hover:text-droid-text'
          }`}
        >
          <GitPullRequestIcon size={15} />
        </span>
        Pull requests
      </button>
      <button
        data-testid="projects-nav"
        aria-current={state.mainView === 'projects' ? 'page' : undefined}
        onClick={() => {
          dispatch({ type: 'OPEN_PROJECTS' });
        }}
        className={`group mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-colors ${state.mainView === 'projects' ? 'bg-droid-active text-droid-text' : 'text-droid-text hover:bg-droid-elevated'}`}
      >
        <MessageCirclePlus className="h-3.5 w-3.5 shrink-0 text-droid-text-secondary" />
        Projects
        {/* A project runs while the user is elsewhere, so the entry says when
            one is moving and when one is holding for them. */}
        <ProjectsPulse
          attention={board.entries.reduce((total, entry) => total + entry.pulse.attention, 0)}
          live={board.entries.some((entry) => entry.pulse.live)}
        />
      </button>
      <button
        ref={automationsButtonRef}
        data-testid="automations-nav"
        onClick={() => {
          dispatch({ type: 'OPEN_AUTOMATIONS' });
        }}
        aria-current={state.mainView === 'automations' ? 'page' : undefined}
        className={`group mt-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium text-droid-text transition-colors ${
          state.mainView === 'automations' ? 'bg-droid-active' : ''
        }`}
      >
        <Clock
          className={`h-3.5 w-3.5 shrink-0 transition-colors ${
            state.mainView === 'automations'
              ? 'text-droid-text'
              : 'text-droid-text-secondary group-hover:text-droid-text'
          }`}
        />
        Automations
      </button>
    </>
  );
}

function ProjectsPulse({ attention, live }: { attention: number; live: boolean }) {
  if (attention > 0) {
    return (
      <span
        title={`${String(attention)} waiting on you`}
        className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-droid-orange/20 px-1 text-[11px] font-medium leading-none text-droid-orange"
      >
        {attention}
      </span>
    );
  }
  if (!live) return null;
  return (
    <span
      aria-label="threads working"
      title="Threads working"
      className="ml-auto h-3 w-3 rounded-full border-[1.5px] border-droid-text-muted border-r-transparent motion-safe:animate-spin-slow"
    />
  );
}
