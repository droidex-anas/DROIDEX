import { useEffect, useRef, type MouseEvent } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector, type Action } from '../hooks/useStore';
import { bindLazySurfaceIntent } from '../lib/chunkPreloader';
import { isEmbedded } from '../lib/embed';
import { opensInNewTab } from '../lib/shortcuts';
import type { ViewPage } from '../features/tabs/tabStrip';
import { resolvePrWorkspaceCwd } from '../features/pull-requests/lib/prWorkspaceCwd';
import { GitPullRequestIcon } from './environment/GithubIcons';
import { Clock, Spinner } from '@droidex/icons';
import { Badge } from './ui/Badge';
import { Row } from './ui/Row';
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
  const navigate = (event: MouseEvent, page: ViewPage, navigation: Action) => {
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
      <Row
        data-testid="pull-requests-nav"
        icon={<GitPullRequestIcon size={16} />}
        label="Pull requests"
        active={state.mainView === 'pull-requests'}
        onClick={openPullRequests}
        onAuxClick={openPullRequests}
        onMouseDown={preventAutoscroll}
      />
      <Row
        ref={projectsButtonRef}
        data-testid="projects-nav"
        aria-current={state.mainView === 'projects' ? 'page' : undefined}
        icon={<ActivityStatusGlyph status="ready" decorative />}
        label="Projects"
        active={state.mainView === 'projects'}
        // A project runs while the user is elsewhere, so the entry says when
        // one is moving and when one is holding for them.
        trailing={
          <ProjectsNavBadge attention={projectsSignal.attention} live={projectsSignal.live} />
        }
        onClick={openProjects}
        onAuxClick={openProjects}
        onMouseDown={preventAutoscroll}
      />
      <ProjectsIntro anchorRef={projectsButtonRef} held={announcementShown} />
      <Row
        ref={automationsButtonRef}
        data-testid="automations-nav"
        aria-current={state.mainView === 'automations' ? 'page' : undefined}
        icon={<Clock className="size-icon-md" />}
        label="Automations"
        active={state.mainView === 'automations'}
        onClick={openAutomations}
        onAuxClick={openAutomations}
        onMouseDown={preventAutoscroll}
      />
    </>
  );
}

// A middle press would otherwise start the browser's autoscroll.
function preventAutoscroll(event: MouseEvent) {
  if (event.button === 1) event.preventDefault();
}

function ProjectsNavBadge({ attention, live }: { attention: number; live: boolean }) {
  if (attention > 0) {
    return (
      <Badge
        tone="warning"
        title={`${String(attention)} waiting on you`}
        className="-my-0.5 tabular-nums"
      >
        {attention}
      </Badge>
    );
  }
  if (!live) return null;
  return (
    <Spinner
      size={14}
      aria-label="threads working"
      className="shrink-0 text-muted motion-safe:animate-spin-slow"
    />
  );
}
