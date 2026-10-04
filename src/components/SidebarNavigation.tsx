import { useEffect, useRef, type MouseEvent } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector, type Action } from '../hooks/useStore';
import { bindLazySurfaceIntent } from '../lib/chunkPreloader';
import { isEmbedded } from '../lib/embed';
import { opensInNewTab } from '../lib/shortcuts';
import type { TabPage } from '../features/tabs/tabStrip';
import { resolvePrWorkspaceCwd } from '../features/pull-requests/lib/prWorkspaceCwd';
import { GitPullRequestIcon } from './environment/GithubIcons';
import { Clock } from '@droidex/icons';
import { ActivityStatusGlyph } from './ActivityStatusGlyph';
import { projectsNavSignal } from '../lib/projectThreads';
import { ProjectsIntro } from '../features/projects/ProjectsIntro';
import { sessionAttention } from '../lib/sessionAttention';
import type { SessionSummary } from '../types/bridge';

export function SidebarNavigation({ announcementShown = false }: { announcementShown?: boolean }) {
  const dispatch = useStoreDispatch();
  const projectsSignal = useStoreSelector(
    (current) => {
      // A project outlives the window's session map, so a thread it names may
      // not be loaded here.
      const sessions: Partial<Record<string, SessionSummary>> = current.sessions;
      return projectsNavSignal(current.projects, {
        streaming: (id) => Boolean(sessions[id]?.streaming),
        blocked: (id) =>
          sessionAttention(id, current.pendingPermissions, current.pendingQuestions) !== null,
      });
    },
    (a, b) => a.attention === b.attention && a.live === b.live,
  );
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
  const projectsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => bindLazySurfaceIntent('automations', automationsButtonRef.current), []);

  if (isEmbedded()) return null;

  // A primary-modifier or middle click gives the view its own tab, then shows
  // it there. Other auxiliary buttons (right click) do nothing.
  const navigate = (event: MouseEvent, page: TabPage, navigation: Action) => {
    const newTab = opensInNewTab(event);
    if (event.button !== 0 && !newTab) return;
    if (newTab) dispatch({ type: 'OPEN_TAB', page });
    dispatch(navigation);
  };
  const openPullRequests = (event: MouseEvent) => {
    const cwd = resolvePrWorkspaceCwd({
      boundCwd: state.prWorkspaceCwd,
      activeCwd: state.activeSession?.cwd,
      workspaceKind: state.activeSession?.workspaceKind,
      workspaceCwds: state.workspaceCwds,
    });
    navigate(event, { kind: 'pull-requests' }, { type: 'OPEN_PULL_REQUESTS', cwd });
  };
  const openProjects = (event: MouseEvent) => {
    navigate(event, { kind: 'projects' }, { type: 'OPEN_PROJECTS' });
  };
  const openAutomations = (event: MouseEvent) => {
    navigate(event, { kind: 'automations' }, { type: 'OPEN_AUTOMATIONS' });
  };

  return (
    <>
      <button
        data-testid="pull-requests-nav"
        onClick={openPullRequests}
        onAuxClick={openPullRequests}
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
        ref={projectsButtonRef}
        data-testid="projects-nav"
        aria-current={state.mainView === 'projects' ? 'page' : undefined}
        onClick={openProjects}
        onAuxClick={openProjects}
        className={`group mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-colors ${state.mainView === 'projects' ? 'bg-droid-active text-droid-text' : 'text-droid-text hover:bg-droid-elevated'}`}
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-droid-text-secondary">
          <ActivityStatusGlyph status="ready" decorative />
        </span>
        Projects
        {/* A project runs while the user is elsewhere, so the entry says when
            one is moving and when one is holding for them. */}
        <ProjectsNavBadge attention={projectsSignal.attention} live={projectsSignal.live} />
      </button>
      <ProjectsIntro anchorRef={projectsButtonRef} held={announcementShown} />
      <button
        ref={automationsButtonRef}
        data-testid="automations-nav"
        onClick={openAutomations}
        onAuxClick={openAutomations}
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

function ProjectsNavBadge({ attention, live }: { attention: number; live: boolean }) {
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
