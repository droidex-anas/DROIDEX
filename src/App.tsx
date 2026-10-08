import { Suspense, useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { shallowEqual, useStoreApi, useStoreDispatch, useStoreSelector } from './hooks/useStore';
import { AnimatePresence, motion } from 'framer-motion';
import { PanelLeft, PanelRight } from '@droidex/icons';
import { hasActiveSessionWork } from './lib/sessions';
import { bridge } from './lib/bridge';
import {
  connect,
  listFactoryDefaults,
  listModels,
  sendSidebarResult,
  openChild,
  newChildOpenRequestId,
  updateCli,
} from './lib/commands';
import { isEmbedded } from './lib/embed';
import { getApiKey, isDesktop, setAppIcon, terminalHasChildren } from './lib/desktop';
import { forwardNativeBrowserShortcuts } from './lib/nativeBrowser';
import { BrowserHost } from './components/browser/BrowserHost';
import { answerSidebarRequest } from './lib/sidebarRequests';
import { shouldOpenSelectedChild } from './lib/childSessions';
import type { ChildAccess } from './hooks/storeChildSession';
import Sidebar from './components/Sidebar';
import RightPanel from './components/RightPanel';
import EditorOpenMenu from './components/EditorOpenMenu';
import Toaster from './components/Toaster';
import { useRepoStatus } from './hooks/useRepoStatus';
import { useChatPullRequests } from './hooks/useChatPullRequests';
import { useDocumentVisible } from './hooks/useDocumentVisible';
import { applyTheme, findPreset, resolveVariant } from './lib/theme';
import { useOnboarding, shouldShowOnboarding, hasSetupBlocker } from './hooks/useOnboarding';
import { useHarnessCliAutoUpdate } from './hooks/useHarnessClis';
import SetupBanner from './components/onboarding/SetupBanner';
import { useMeasuredHeight } from './hooks/useMeasuredHeight';
import {
  TOP_ROW_HEIGHT_PX,
  WINDOW_CONTROLS_INSET_PX,
  WINDOW_CONTROLS_LEAD_PX,
} from './lib/windowChrome';
import { HeaderTabs } from './features/tabs/HeaderTabs';
import { RunningProcessesMenu } from './components/RunningProcessesMenu';
import { ChatTiles } from './features/tabs/ChatTiles';
import {
  activeGrid,
  adjacentTabId,
  numberedTabId,
  showsTabStrip,
  type TabAction,
} from './features/tabs/tabStrip';
import { adjacentTileId, nextSplit, type TileEdge } from './features/tabs/tileGrid';
import RuntimeStatusBanner from './components/RuntimeStatusBanner';
import { checkForAppUpdateAutomatically, startAutomaticAppUpdateChecks } from './lib/appUpdate';
import { toast } from './lib/toast';
import { UtilityPane } from './components/utility/UtilityPane';
import { terminalInstances, releaseTerminalInstancesExcept } from './lib/terminalInstanceRegistry';
import {
  isExpandableTool,
  utilityPanelForSession,
  terminalTabIds,
  type UtilityTab,
  type UtilityTool,
} from './lib/utilityPanel';
import {
  isTerminalInputTarget,
  isTerminalTabShortcut,
  utilityToolShortcut,
} from './lib/keyboardShortcuts';
import {
  SHORTCUT_DEFINITIONS,
  formatChord,
  matchesChord,
  nativeBrowserChords,
  tabNumberFromEvent,
  type ShortcutAction,
} from './lib/shortcuts';
import { useSessionWorkingDirectory } from './hooks/useSessionWorkingDirectory';
import { useDiagnosticsContext } from './hooks/useDiagnosticsContext';
import { listProjects, restoreBrowsersCommand } from './lib/commands';
import { useFinishNotifications } from './hooks/useFinishNotifications';
import { useThreadsPaneAutoOpen } from './features/projects/useThreadsPaneAutoOpen';
import { useWorkspaceScopes } from './hooks/useWorkspaceScopes';
import { useWorkspaceSessionList } from './hooks/useWorkspaceSessionList';
import { useHistoryIndexingIdle } from './hooks/useHistoryIndexingIdle';
import { useBackgroundWorkTier } from './hooks/useBackgroundWorkTier';
import { useSessionHistory } from './hooks/useSessionHistory';
import { sideChatPanel } from './lib/sideChats';
import { useCloseSideChat } from './components/sidechats/useCloseSideChat';
import {
  bindLazySurfaceIntent,
  scheduleIdleLazyWarmup,
  cancelIdleLazyWarmup,
} from './lib/chunkPreloader';
import { OnboardingLazyHost } from './components/onboarding/OnboardingLazyHost';
import { SettingsLazyHost } from './components/SettingsLazyHost';
import {
  CommandPaletteSkeleton,
  MissionControlSkeleton,
  PanelSkeleton,
  PullRequestsSkeleton,
} from './components/skeletons/WorkspaceSkeletons';
import {
  LazyAutomationsRoute,
  LazyProjectsRoute,
  LazyBrowserFocusWorkspace,
  LazyCommandPalette,
  LazyAgentsWorkspace,
  LazyThreadsWorkspace,
  LazyThreadAttentionNotifier,
  LazyFilesWorkspace,
  LazyMissionControl,
  LazyPullRequestsView,
  LazyReviewPanel,
  LazySideChatsWorkspace,
  LazySideChatWindow,
  LazySpecWikiModal,
  LazyTerminalWorkspace,
  utilityToolFallback,
} from './lib/lazySurfaces';
import { noteComposerNotApplicable, noteFirstMeaningfulShellPaint } from './lib/rendererPerf';

function ContextListIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="5" cy="8" r="1.6" />
      <line x1="10" y1="8" x2="19" y2="8" />
      <circle cx="5" cy="16" r="1.6" />
      <line x1="10" y1="16" x2="19" y2="16" />
    </svg>
  );
}

const UTILITY_PANE_MIN = 420;
const UTILITY_PANE_MAX = 980;
const UTILITY_PANE_DEFAULT = 560;
const UTILITY_PANE_CONTENT_RESERVE = 520;
const UTILITY_PANE_WIDTH_STORAGE_KEY = 'droid-utility-pane-width';

// selectedChild can outlive its childAccess entry after failed/closed cleanup
// (withoutChildAccess deletes the parent key). Record indexing types that as
// always present; this runtime-safe lookup returns undefined instead of throwing.
function childAccessForSelection(
  childAccess: Record<string, Record<string, ChildAccess>>,
  parentAppSessionId: string,
  childSessionId: string,
): ChildAccess | undefined {
  if (!Object.hasOwn(childAccess, parentAppSessionId)) return undefined;
  return childAccess[parentAppSessionId][childSessionId];
}

export default function App() {
  useChatPullRequests();
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const state = useStoreSelector((current) => {
    const activeSession = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : null;
    return {
      activeSession,
      activeTabSplit: activeGrid(current.tabStrip) !== null,
      childAccess: current.childAccess,
      commandPaletteOpen: current.commandPaletteOpen,
      customThemes: current.customThemes,
      hasSessionContent: Boolean(
        activeSession && (current.transcripts[activeSession.appSessionId] ?? []).length > 0,
      ),
      mainView: current.mainView,
      rightPanelOpen: current.rightPanelOpen,
      selectedChild: current.selectedChild,
      settingsOpen: current.settingsOpen,
      sideChatPlacement: activeSession
        ? sideChatPanel(current.sideChats, activeSession.appSessionId).placement
        : 'docked',
      shortcutBindings: current.shortcutBindings,
      sidebarCollapsed: current.sidebarCollapsed,
      tabStripShown: showsTabStrip(current),
      theme: current.theme,
      utilityPanels: current.utilityPanels,
      workspaceCwds: current.workspaceCwds,
    };
  }, shallowEqual);
  const embedded = isEmbedded();
  useEffect(() => {
    if (!embedded) return;
    if (state.mainView === 'projects') {
      dispatch({ type: 'CLOSE_PROJECTS' });
    } else if (state.mainView === 'automations') {
      dispatch({ type: 'CLOSE_AUTOMATIONS' });
    } else if (state.mainView === 'pull-requests') {
      dispatch({ type: 'CLOSE_PULL_REQUESTS' });
    }
  }, [dispatch, embedded, state.mainView]);
  const onboard = useOnboarding();
  useDiagnosticsContext();
  useHistoryIndexingIdle();
  useBackgroundWorkTier();
  const [forceWizard, setForceWizard] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [expandedPaneAppSessionId, setExpandedPaneAppSessionId] = useState<string | null>(null);
  const cliLaunchHandled = useRef(false);
  const appUpdateLaunchCheckHandled = useRef(false);
  const showWizard =
    !embedded && onboard.ready && (forceWizard || shouldShowOnboarding(onboard.onboarding));
  // Desktop-only: toast when a model turn finishes (snippet + optional sound).
  useFinishNotifications(!embedded && !showWizard);
  const hasProjects = useStoreSelector((current) => current.projects.length > 0);
  useThreadsPaneAutoOpen();
  const activeSession = state.activeSession;
  const workingDirectory = useSessionWorkingDirectory(activeSession);
  const repoStatus = useRepoStatus(workingDirectory);
  const documentVisible = useDocumentVisible();
  const setCanonicalWorkspaceCwds = useCallback(
    (cwds: string[]) => {
      dispatch({ type: 'SET_WORKSPACE_CWDS', cwds });
    },
    [dispatch],
  );
  const { scopes: workspaceScopes, ready: workspaceScopesReady } = useWorkspaceScopes(
    state.workspaceCwds,
    !embedded && documentVisible,
    setCanonicalWorkspaceCwds,
  );
  const showEarlierSessions = useWorkspaceSessionList(
    workspaceScopes,
    !embedded && workspaceScopesReady,
  );
  // Mission Control is active only for a session explicitly created for it,
  // not merely because the compose preview is open.
  const isMissionControlView = activeSession?.sessionPurpose === 'mission-control';
  const utilityPanel = utilityPanelForSession(state.utilityPanels, activeSession?.appSessionId);
  const activeUtilityTab =
    utilityPanel.tabs.find((tab) => tab.id === utilityPanel.activeTabId) ?? null;
  // The pull request and Automations workspaces own the whole content area and
  // the top-right corner of their own toolbar, so the session-scoped panes and
  // overlays (utility pane, Context panel) and floating window buttons stay out
  // of them instead of covering their header. The pane's open state survives
  // the visit and it comes back with the chat.
  const fullContentRoute =
    !embedded &&
    (state.mainView === 'pull-requests' ||
      state.mainView === 'automations' ||
      state.mainView === 'projects');
  const showUtilityPane =
    !embedded && !!activeSession && utilityPanel.open && !showWizard && !fullContentRoute;
  // An expanded browser or agent covers the full content row; the utility pane
  // already stays out of the full-content routes, so the expansion follows it.
  const paneExpanded =
    !!activeSession &&
    showUtilityPane &&
    isExpandableTool(activeUtilityTab?.tool) &&
    expandedPaneAppSessionId === activeSession.appSessionId;
  // An expanded browser keeps the chat's one composer: the chat column becomes
  // an overlay layer so the same composer moves under the page instead of a
  // second one mounting there (which lost the draft on every switch). Mission
  // Control owns its own composer and keeps the browser's for now.
  const browserExpanded =
    paneExpanded && activeUtilityTab?.tool === 'browser' && !isMissionControlView;
  const focused = isMissionControlView;
  // A normal/spec session only has something worth showing once a message has
  // been sent (the first transcript is seeded from the opening prompt).
  const hasSessionContent = state.hasSessionContent;
  // The context toggle is meaningful in Mission Control (always) and in a normal
  // chat only after it has content; otherwise there is nothing to open.
  const canToggleContext = isMissionControlView || hasSessionContent;
  // The context panel floats *over* the chat as an overlay (it does not shrink
  // the main scroll area), so the page scrollbar stays pinned to the window's
  // right edge instead of sliding inward and looking like a divider.
  const rightPanelVisible =
    !focused && !fullContentRoute && !showUtilityPane && state.rightPanelOpen && hasSessionContent;
  const [utilityPaneWidth, setUtilityPaneWidth] = useState(() => initialUtilityPaneWidth());
  const [utilityPaneMax, setUtilityPaneMax] = useState(() => utilityPaneMaxWidth());
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  // The side tab leaving the pane must not hand its expansion to the next tab.
  const sideChatClose = useCloseSideChat(() => {
    setExpandedPaneAppSessionId(null);
  });
  // A late busy-check must not restore a dialog in a hidden or replaced pane.
  const visibleUtilityPanelRef = useRef(showUtilityPane ? utilityPanel : null);
  visibleUtilityPanelRef.current = showUtilityPane ? utilityPanel : null;
  const confirmingTab = utilityPanel.tabs.find((tab) => tab.id === confirmCloseTabId) ?? null;
  const contentRowRef = useRef<HTMLDivElement>(null);
  const [contentRowWidth, setContentRowWidth] = useState(0);
  // The toggle moves between the tab row and the chat header, so its preload
  // listeners follow the button itself.
  const bindUtilityToggleIntent = useCallback((toggle: HTMLButtonElement) => {
    const cleanups = [
      bindLazySurfaceIntent('browser', toggle),
      bindLazySurfaceIntent('files', toggle),
      bindLazySurfaceIntent('terminal', toggle),
      bindLazySurfaceIntent('review', toggle),
    ];
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
  const shellPaintMarked = useRef(false);
  const composerStartupResolved = useRef(false);

  // The busy-shell confirmation popover is only meaningful for the tab that
  // raised it, in the active session's still-open panel. Switching sessions
  // (utilityPanel now points at a different panel), closing the panel
  // (UtilityPane unmounts), or activating a different tab must not leave a
  // stale id armed for a tab no longer on screen. `onCloseTab` activates the
  // confirming tab itself (to bring its TerminalWorkspace on screen before
  // arming the dialog), so this only clears when the active tab has changed
  // to something other than the one currently confirming.
  useEffect(() => {
    setConfirmCloseTabId((current) =>
      utilityPanel.open && current === utilityPanel.activeTabId ? current : null,
    );
  }, [activeSession?.appSessionId, utilityPanel.open, utilityPanel.activeTabId]);

  // A chat that is deleted or archived drops its utility panel from the store
  // (see the useStore reducer — a closing session keeps its panel, because the
  // sidecar retires idle runtimes while the chat and its PTYs stay live), which removes
  // any terminal tabs it held. Release the matching xterm/pty instances so
  // they don't keep running in the background with nothing to reopen them.
  const hasActiveWork = useStoreSelector(hasActiveSessionWork);
  const liveTerminalTabIds = useMemo(
    () => terminalTabIds(state.utilityPanels),
    [state.utilityPanels],
  );
  useEffect(() => {
    void releaseTerminalInstancesExcept(
      new Set(liveTerminalTabIds.split('\n').filter(Boolean)),
    ).catch((error: unknown) => {
      console.warn('Terminal cleanup failed', error);
      toast.error('Could not close a terminal.');
    });
  }, [liveTerminalTabIds]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!shellPaintMarked.current) {
        shellPaintMarked.current = true;
        noteFirstMeaningfulShellPaint();
      }
      if (!hasActiveWork) scheduleIdleLazyWarmup(() => hasActiveSessionWork(store.getState()));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelIdleLazyWarmup();
    };
  }, [hasActiveWork, store]);

  useEffect(() => {
    if (composerStartupResolved.current) return;
    if (!isMissionControlView && !fullContentRoute) return;
    composerStartupResolved.current = true;
    noteComposerNotApplicable();
  }, [isMissionControlView, fullContentRoute]);

  const toggleRightPanel = useCallback(() => {
    const open = !state.rightPanelOpen;
    dispatch({ type: 'SET_RIGHT_PANEL', open });
  }, [dispatch, state.rightPanelOpen]);

  const toggleUtilityPane = useCallback(() => {
    // Closing the pane also ends a full-width browser expansion, so reopening
    // it later brings the pane back at its normal width beside the chat.
    if (utilityPanel.open) setExpandedPaneAppSessionId(null);
    dispatch({ type: 'SET_UTILITY_PANEL_OPEN', open: !utilityPanel.open });
  }, [dispatch, utilityPanel.open]);

  const openUtilityTool = useCallback(
    (tool: UtilityTool) => {
      // A side chat lives in one place at a time, so opening its tab docks it.
      const sourceAppSessionId = activeSession?.appSessionId;
      if (tool === 'side' && sourceAppSessionId) {
        dispatch({
          type: 'PLACE_SIDE_CHATS',
          sourceAppSessionId,
          placement: 'docked',
        });
        return;
      }
      dispatch({
        type: 'OPEN_UTILITY_TOOL',
        tool,
        tabId: tool === 'terminal' ? crypto.randomUUID() : undefined,
        cwd: tool === 'terminal' ? workingDirectory : undefined,
      });
    },
    [dispatch, workingDirectory, activeSession?.appSessionId],
  );

  const closeTerminalTab = useCallback(
    (tab: UtilityTab) => {
      setConfirmCloseTabId(null);
      dispatch({
        type: 'CLOSE_UTILITY_TAB',
        tabId: tab.id,
        appSessionId: activeSession?.appSessionId ?? '',
      });
    },
    [dispatch, activeSession?.appSessionId],
  );

  useEffect(() => {
    const onResize = () => {
      const available = contentRowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setUtilityPaneMax(utilityPaneMaxWidth(available));
      setUtilityPaneWidth((width) => clampUtilityPane(width, available));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    const node = contentRowRef.current;
    if (!node) return;
    const update = () => {
      const available = Math.round(node.getBoundingClientRect().width);
      setContentRowWidth(available);
      setUtilityPaneMax(utilityPaneMaxWidth(available));
      setUtilityPaneWidth((width) => clampUtilityPane(width, available));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    applyTheme(state.theme);
  }, [state.theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (documentVisible) root.removeAttribute('data-window-hidden');
    else root.setAttribute('data-window-hidden', 'true');
    return () => {
      root.removeAttribute('data-window-hidden');
    };
  }, [documentVisible]);

  useEffect(() => {
    if (embedded) return;
    void setAppIcon(state.theme.appIconMode).catch((error: unknown) => {
      console.error('Failed to update app icon', error);
    });
  }, [embedded, state.theme.appIconMode]);

  useEffect(() => {
    if (state.theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      // Follow the OS scheme with the active preset's matching variant.
      // Hand-edited (custom) colors have no second variant, so they stay put.
      const preset = findPreset(state.theme.presetId, state.customThemes);
      if (preset) dispatch({ type: 'SET_THEME', theme: resolveVariant(preset, 'system') });
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, [state.theme.mode, state.theme.presetId, state.customThemes, dispatch]);

  useEffect(() => {
    if (embedded) return;
    // A sidecar that just started has none of the browsers the app kept, so
    // every pane action would fail until the agent opened a page again. Each
    // new connection hands them over before any queued pane command.
    bridge.sendFirstOnOpen(() => restoreBrowsersCommand(store.getState().browsers));
    void (async () => {
      // Bridge info and the saved API key are independent IPCs; fetch them
      // together so the connect command reaches the sidecar one round-trip
      // sooner. Queued commands flush in order once the socket opens.
      const [, key] = await Promise.all([bridge.start(), getApiKey()]);
      connect(key ?? '');
      listFactoryDefaults();
      // The session panel and composer badge name the model from this catalog;
      // without it a custom model shows as its raw id until the selector opens.
      listModels();
    })();
  }, [embedded, store]);

  // The chat list hides a project's threads, so it waits to have been answered
  // about them before it draws. Asking on every connection rather than once at
  // startup keeps that true after a reconnect, and keeps the list from
  // depending on one call at one moment to ever be made.
  const connection = useStoreSelector((current) => current.connection);
  useEffect(() => {
    if (connection === 'connected') listProjects();
  }, [connection]);

  // App update discovery must never wait on CLI/env probing: that work can be
  // slow or unavailable, while the verified appcast is independent.
  useEffect(() => {
    if (embedded) return;
    if (!onboard.ready || !onboard.onboarding?.completed) return;
    if (onboard.onboarding.appAutoUpdate === false) return;
    return startAutomaticAppUpdateChecks(() => {
      const resumeDeferred = !appUpdateLaunchCheckHandled.current;
      appUpdateLaunchCheckHandled.current = true;
      void checkForAppUpdateAutomatically(resumeDeferred);
    });
  }, [embedded, onboard.ready, onboard.onboarding?.completed, onboard.onboarding?.appAutoUpdate]);

  // Optional CLI maintenance still waits for environment detection, but it no
  // longer gates app update discovery or the sidebar update button.
  useEffect(() => {
    if (embedded || cliLaunchHandled.current) return;
    if (!onboard.ready || !onboard.onboarding?.completed) return;
    // Defer until env detection lands so the CLI auto-update isn't skipped by a
    // race where this runs before `env` arrives.
    const wantsCliAutoUpdate = onboard.onboarding.cliAutoUpdate !== false;
    if (wantsCliAutoUpdate && !onboard.env) return;
    cliLaunchHandled.current = true;
    if (wantsCliAutoUpdate && onboard.env?.cli.present) {
      updateCli(onboard.onboarding.installChannel);
    }
  }, [embedded, onboard.ready, onboard.onboarding, onboard.env]);

  useHarnessCliAutoUpdate(
    !embedded &&
      onboard.ready &&
      onboard.onboarding?.completed === true &&
      onboard.onboarding.harnessCliAutoUpdate !== false,
  );

  // Surface the result of a background CLI update.
  useEffect(() => {
    if (onboard.lastResult?.phase !== 'update') return;
    if (onboard.lastResult.ok) toast.success('Droid CLI is up to date.');
  }, [onboard.lastResult]);

  // "Run setup again" from Settings re-opens the tour.
  useEffect(() => {
    const onOpen = () => {
      setBannerDismissed(false);
      setForceWizard(true);
    };
    window.addEventListener('droid:open-onboarding', onOpen);
    return () => {
      window.removeEventListener('droid:open-onboarding', onOpen);
    };
  }, []);

  useEffect(() => {
    if (embedded) return;
    const unsub = bridge.subscribe((event) => {
      // Answered here rather than in the Sidebar, which unmounts when collapsed.
      if (event.type === 'sidebar.request') {
        const result = answerSidebarRequest(event.request, store.getState(), (appSessionId) => {
          dispatch({ type: 'ARCHIVE_CHAT', appSessionId });
        });
        if (result) sendSidebarResult(result);
        return;
      }
    });
    return () => {
      unsub();
    };
  }, [dispatch, embedded, store]);

  useSessionHistory(embedded ? null : (activeSession?.appSessionId ?? null));

  useEffect(() => {
    if (embedded || !activeSession) return;
    const selection = state.selectedChild;
    if (!selection) return;
    if (selection.parentAppSessionId !== activeSession.appSessionId) return;
    const access = childAccessForSelection(
      state.childAccess,
      selection.parentAppSessionId,
      selection.childSessionId,
    );
    if (!shouldOpenSelectedChild(access)) return;
    const requestId = newChildOpenRequestId();
    dispatch({ type: 'SELECT_CHILD', selection, requestId });
    openChild(selection.parentAppSessionId, selection.childSessionId, requestId);
  }, [activeSession, embedded, state.selectedChild, state.childAccess, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    // An embedded copy of the app shows no tabs, so it leaves their chords to
    // whatever hosts it instead of swallowing them.
    const tabAction = (action: () => TabAction | null) =>
      embedded
        ? null
        : () => {
            const next = action();
            if (next) dispatch(next);
          };
    const tabStrip = () => store.getState().tabStrip;
    const splitNewChat = (preferred: TileEdge) =>
      tabAction(() => {
        const grid = activeGrid(tabStrip());
        const split = grid ? nextSplit(grid, preferred) : null;
        return {
          type: 'SPLIT_TILE',
          targetTileId: split?.targetTileId ?? null,
          edge: split?.edge ?? preferred,
          appSessionId: null,
        };
      });
    const focusAdjacentTile = (offset: 1 | -1) =>
      tabAction(() => {
        const grid = activeGrid(tabStrip());
        return grid ? { type: 'FOCUS_TILE', tileId: adjacentTileId(grid, offset) } : null;
      });
    const run: Record<ShortcutAction, (() => void) | null> = {
      toggleSidebar: () => {
        dispatch({ type: 'TOGGLE_SIDEBAR' });
      },
      toggleUtilityPane,
      openCommandPalette: () => {
        dispatch({ type: 'TOGGLE_COMMAND_PALETTE' });
      },
      openSettings: () => {
        dispatch({ type: 'TOGGLE_SETTINGS' });
      },
      newTab: tabAction(() => ({ type: 'OPEN_NEW_CHAT_TAB' })),
      closeTab: tabAction(() => ({ type: 'CLOSE_TAB', tabId: tabStrip().activeTabId })),
      reopenClosedTab: tabAction(() => ({ type: 'REOPEN_CLOSED_TAB' })),
      nextTab: tabAction(() => ({ type: 'ACTIVATE_TAB', tabId: adjacentTabId(tabStrip(), 1) })),
      previousTab: tabAction(() => ({
        type: 'ACTIVATE_TAB',
        tabId: adjacentTabId(tabStrip(), -1),
      })),
      splitRight: splitNewChat('right'),
      splitDown: splitNewChat('bottom'),
      nextTile: focusAdjacentTile(1),
      previousTile: focusAdjacentTile(-1),
      closeTile: tabAction(() => {
        const grid = activeGrid(tabStrip());
        return grid ? { type: 'CLOSE_TILE', tileId: grid.focusedTileId } : null;
      }),
    };
    const handler = (e: KeyboardEvent) => {
      // A saved binding wins over the fixed chords below, so rebinding an
      // action onto one of them takes effect instead of being swallowed.
      for (const { action } of SHORTCUT_DEFINITIONS) {
        const perform = run[action];
        if (!perform || !matchesChord(e, state.shortcutBindings[action])) continue;
        // A shell owns its Ctrl chords (Ctrl+\ is SIGQUIT); Cmd chords never
        // reach it, so on macOS they still toggle from inside the terminal.
        if (isTerminalInputTarget(e.target) && !e.metaKey) return;
        e.preventDefault();
        // A held key auto-repeats and would toggle straight back.
        if (e.repeat) return;
        perform();
        return;
      }
      const tabNumber = embedded ? null : tabNumberFromEvent(e);
      if (tabNumber !== null) {
        if (isTerminalInputTarget(e.target) && !e.metaKey) return;
        e.preventDefault();
        const tabId = numberedTabId(tabStrip(), tabNumber);
        if (tabId) dispatch({ type: 'ACTIVATE_TAB', tabId });
        return;
      }
      if (isTerminalTabShortcut(e)) {
        if (isTerminalInputTarget(e.target)) return;
        e.preventDefault();
        if (e.repeat) return;
        openUtilityTool('terminal');
        return;
      }
      const tool = utilityToolShortcut(e);
      if (tool) {
        e.preventDefault();
        openUtilityTool(tool);
      }
    };
    window.addEventListener('keydown', handler);
    const stopForwarding = embedded
      ? null
      : forwardNativeBrowserShortcuts(nativeBrowserChords(state.shortcutBindings), (press) => {
          handler(new KeyboardEvent('keydown', press));
        });
    return () => {
      window.removeEventListener('keydown', handler);
      stopForwarding?.();
    };
  }, [dispatch, embedded, openUtilityTool, state.shortcutBindings, store, toggleUtilityPane]);

  const setupBlocker =
    !showWizard &&
    !embedded &&
    onboard.ready &&
    onboard.onboarding?.completed === true &&
    hasSetupBlocker(onboard.env);
  const showBanner = !bannerDismissed && setupBlocker;
  // Banners stack above the title row; the floating window controls sit just
  // below whatever is showing.
  const bannerStackRef = useRef<HTMLDivElement>(null);
  const bannerStackHeight = useMeasuredHeight(bannerStackRef);

  // A lone chat in a tab has no header of its own: the tab names it, and its
  // running processes join these controls in the tab row.
  const listsProcesses =
    state.tabStripShown && !state.activeTabSplit && !isMissionControlView && !!activeSession;
  const sessionControls = fullContentRoute ? null : (
    <>
      {listsProcesses && <RunningProcessesMenu appSessionId={activeSession.appSessionId} />}
      {!showUtilityPane && (
        <>
          {workingDirectory && (
            <EditorOpenMenu cwd={workingDirectory} hasRepo={!!repoStatus} variant="toolbar" />
          )}
          {canToggleContext && (
            <button
              onClick={toggleRightPanel}
              aria-label="Toggle context panel"
              aria-pressed={state.rightPanelOpen}
              // No pressed fill: like the sidebar and utility toggles beside it,
              // the open panel is its own evidence; the icon only brightens.
              className={`rounded-md p-1.5 transition-colors hover:bg-droid-elevated/60 hover:text-droid-text ${
                state.rightPanelOpen ? 'text-droid-text' : 'text-droid-text-muted/70'
              }`}
              title="Toggle context"
            >
              <ContextListIcon className="h-4 w-4" />
            </button>
          )}
          {!!activeSession && (
            <button
              ref={bindUtilityToggleIntent}
              onClick={toggleUtilityPane}
              className="rounded-md p-1.5 text-droid-text-muted/70 transition-colors hover:bg-droid-elevated/60 hover:text-droid-text"
              title={`Toggle utility pane (${formatChord(state.shortcutBindings.toggleUtilityPane)})`}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </>
  );

  return (
    <div
      id="app-root"
      className="h-screen w-screen flex flex-col bg-droid-bg text-droid-text overflow-hidden relative"
    >
      <div ref={bannerStackRef} className="shrink-0">
        {showBanner && (
          <SetupBanner
            kind="blocker"
            message="Finish setting up Droid to start running agents."
            actionLabel="Finish setup"
            onAction={() => {
              setForceWizard(true);
            }}
            onDismiss={() => {
              setBannerDismissed(true);
            }}
          />
        )}
        <RuntimeStatusBanner />
      </div>
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar with collapse animation */}
        <AnimatePresence initial={false}>
          {!state.sidebarCollapsed && (
            <motion.div
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 overflow-hidden h-full"
            >
              <Sidebar
                workspaceScopes={workspaceScopes}
                onShowEarlierSessions={showEarlierSessions}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Every view under `main` owns a drag row as its top row, so a view
            never shifts when the sidebar collapses. Collapsing only moves the
            window controls and the floating sidebar toggle into that row; the
            chat header reads the collapsed state and leaves them room. With a
            second tab open, the tab strip stacks above and takes that role. */}
        <main className="relative flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden bg-droid-bg">
          {state.tabStripShown && (
            <HeaderTabs
              leadPx={state.sidebarCollapsed ? WINDOW_CONTROLS_LEAD_PX : 16}
              controls={sessionControls}
            />
          )}
          <div ref={contentRowRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <section
              aria-hidden={paneExpanded && !browserExpanded}
              // Behind an expanded side chat or agent the column is hidden, and
              // a few composer controls turn pointer events back on; inert
              // keeps the whole column out of reach.
              inert={paneExpanded && !browserExpanded}
              className={`flex min-w-0 flex-col overflow-hidden ${
                browserExpanded
                  ? 'pointer-events-none absolute inset-0 z-20'
                  : `relative flex-1 ${paneExpanded ? 'pointer-events-none' : ''}`
              }`}
            >
              {!embedded && state.mainView === 'projects' ? (
                <Suspense fallback={<PanelSkeleton title="projects" />}>
                  <LazyProjectsRoute />
                </Suspense>
              ) : !embedded && state.mainView === 'pull-requests' ? (
                <Suspense fallback={<PullRequestsSkeleton />}>
                  <LazyPullRequestsView />
                </Suspense>
              ) : !embedded && state.mainView === 'automations' ? (
                <Suspense fallback={<PanelSkeleton title="automations" />}>
                  <LazyAutomationsRoute
                    workspaceScopes={workspaceScopes}
                    workspaceScopesReady={workspaceScopesReady}
                  />
                </Suspense>
              ) : isMissionControlView ? (
                <motion.div
                  key="mission-control"
                  className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"
                  initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 0.4 }}
                  animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Suspense fallback={<MissionControlSkeleton />}>
                    <LazyMissionControl />
                  </Suspense>
                </motion.div>
              ) : (
                <>
                  <ChatTiles
                    rightInset={rightPanelVisible}
                    isObscured={paneExpanded}
                    besidePane={showUtilityPane}
                    underBrowser={browserExpanded}
                    composerHost={contentRowRef}
                  />
                  {activeSession && state.sideChatPlacement === 'floating' ? (
                    <div
                      aria-hidden={browserExpanded || undefined}
                      className={browserExpanded ? 'invisible' : 'contents'}
                    >
                      <Suspense fallback={null}>
                        <LazySideChatWindow sourceAppSessionId={activeSession.appSessionId} />
                      </Suspense>
                    </div>
                  ) : null}
                </>
              )}
            </section>
            {/* Holds the chat column's place while it floats, so the pane stays
                anchored on the right as it widens. */}
            {browserExpanded && <div className="min-w-0 flex-1" />}
            {sideChatClose.dialog}

            <AnimatePresence initial={false}>
              {showUtilityPane && (
                <motion.div
                  key="utility-pane"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{
                    width: paneExpanded && contentRowWidth > 0 ? contentRowWidth : utilityPaneWidth,
                    opacity: 1,
                  }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full min-w-0 shrink-0 overflow-hidden"
                >
                  <UtilityPane
                    panel={utilityPanel}
                    expanded={paneExpanded}
                    width={utilityPaneWidth}
                    minWidth={UTILITY_PANE_MIN}
                    maxWidth={utilityPaneMax}
                    onResize={setUtilityPaneWidth}
                    onResizeEnd={(width) => {
                      const next = clampUtilityPane(width, contentRowWidth || undefined);
                      setUtilityPaneWidth(next);
                      try {
                        localStorage.setItem(UTILITY_PANE_WIDTH_STORAGE_KEY, String(next));
                      } catch {
                        /* ignore */
                      }
                    }}
                    onOpenTool={openUtilityTool}
                    onActivateTab={(tabId) => {
                      const nextTab = utilityPanel.tabs.find((tab) => tab.id === tabId);
                      if (!isExpandableTool(nextTab?.tool)) setExpandedPaneAppSessionId(null);
                      dispatch({ type: 'ACTIVATE_UTILITY_TAB', tabId });
                    }}
                    onCloseTab={(tab) => {
                      if (tab.tool === 'terminal') {
                        const status = terminalInstances.get(tab.id)?.getState().status;
                        if (!tab.terminalId || status !== 'running') {
                          closeTerminalTab(tab);
                          return;
                        }
                        const armCloseConfirm = () => {
                          // The check may resolve after the user switched
                          // sessions or closed the pane; only arm the
                          // confirmation if this tab is still on screen.
                          const panel = visibleUtilityPanelRef.current;
                          if (!panel?.tabs.some((current) => current.id === tab.id)) {
                            return;
                          }
                          // Only the active tab's TerminalWorkspace is
                          // mounted, so the confirmation has nowhere to
                          // render unless this tab is brought forward first
                          // — mirror onActivateTab's browser-expanded reset.
                          if (tab.id !== panel.activeTabId) {
                            setExpandedPaneAppSessionId(null);
                            dispatch({ type: 'ACTIVATE_UTILITY_TAB', tabId: tab.id });
                          }
                          setConfirmCloseTabId(tab.id);
                        };
                        void terminalHasChildren(tab.terminalId)
                          .then((busy) => {
                            if (!busy) {
                              closeTerminalTab(tab);
                              return;
                            }
                            armCloseConfirm();
                          })
                          .catch(() => {
                            // Unverifiable shell state: fall back to asking
                            // rather than silently doing nothing.
                            armCloseConfirm();
                          });
                        return;
                      }
                      // The tab's Close is the side chat's own Close; hiding
                      // the tab alone would bring the same chat back on the
                      // next `/btw`. Minimize is the way to put it away.
                      if (tab.tool === 'side') {
                        sideChatClose.requestClose(activeSession.appSessionId);
                        return;
                      }
                      if (isExpandableTool(tab.tool)) setExpandedPaneAppSessionId(null);
                      dispatch({ type: 'CLOSE_UTILITY_TAB', tabId: tab.id });
                    }}
                    onClosePane={() => {
                      setExpandedPaneAppSessionId(null);
                      dispatch({ type: 'SET_UTILITY_PANEL_OPEN', open: false });
                    }}
                    renderTab={(tab) => {
                      if (tab.tool === 'side') {
                        return (
                          <Suspense fallback={utilityToolFallback('side')}>
                            <LazySideChatsWorkspace
                              sourceAppSessionId={activeSession.appSessionId}
                              expanded={paneExpanded}
                              onToggleExpanded={() => {
                                setExpandedPaneAppSessionId(
                                  paneExpanded ? null : activeSession.appSessionId,
                                );
                              }}
                            />
                          </Suspense>
                        );
                      }
                      if (tab.tool === 'agents') {
                        return (
                          <Suspense fallback={utilityToolFallback('agents')}>
                            <LazyAgentsWorkspace
                              tab={tab}
                              expanded={paneExpanded}
                              onToggleExpanded={() => {
                                setExpandedPaneAppSessionId(
                                  paneExpanded ? null : activeSession.appSessionId,
                                );
                              }}
                            />
                          </Suspense>
                        );
                      }
                      if (tab.tool === 'threads') {
                        return (
                          <Suspense fallback={utilityToolFallback('threads')}>
                            <LazyThreadsWorkspace tab={tab} />
                          </Suspense>
                        );
                      }
                      if (tab.tool === 'review') {
                        return (
                          <Suspense fallback={utilityToolFallback('review')}>
                            <LazyReviewPanel cwd={workingDirectory} />
                          </Suspense>
                        );
                      }
                      if (tab.tool === 'browser') {
                        return (
                          <Suspense fallback={utilityToolFallback('browser')}>
                            <LazyBrowserFocusWorkspace
                              expanded={paneExpanded}
                              ownComposer={paneExpanded && isMissionControlView}
                              onToggleExpanded={() => {
                                setExpandedPaneAppSessionId(
                                  paneExpanded ? null : activeSession.appSessionId,
                                );
                              }}
                            />
                          </Suspense>
                        );
                      }
                      if (tab.tool === 'terminal') {
                        return (
                          <Suspense fallback={utilityToolFallback('terminal')}>
                            <LazyTerminalWorkspace
                              tabId={tab.id}
                              terminalId={tab.terminalId}
                              appSessionId={activeSession.appSessionId}
                              cwd={tab.cwd ?? workingDirectory}
                              confirmClose={tab.id === confirmingTab?.id}
                              onKeepOpen={() => {
                                setConfirmCloseTabId(null);
                              }}
                              onStopAndClose={() => {
                                closeTerminalTab(tab);
                              }}
                              onCreated={(terminalId, label) => {
                                dispatch({
                                  type: 'UPDATE_UTILITY_TAB',
                                  tabId: tab.id,
                                  appSessionId: activeSession.appSessionId,
                                  terminalId,
                                  label,
                                });
                              }}
                            />
                          </Suspense>
                        );
                      }
                      return (
                        <Suspense fallback={utilityToolFallback('files')}>
                          <LazyFilesWorkspace
                            root={workingDirectory}
                            selectedPath={tab.filePath}
                            onSelectPath={(filePath) => {
                              dispatch({
                                type: 'UPDATE_UTILITY_TAB',
                                tabId: tab.id,
                                appSessionId: activeSession.appSessionId,
                                filePath,
                              });
                            }}
                          />
                        </Suspense>
                      );
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Floating overlay — does not take flex space, so `main` keeps full
            width and its scrollbar stays at the window's right edge. */}
        <AnimatePresence initial={false}>
          {rightPanelVisible && (
            <motion.div
              key="right-panel"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute bottom-0 right-0 w-[312px] z-30"
              style={{ top: state.tabStripShown ? TOP_ROW_HEIGHT_PX : 0 }}
            >
              <RightPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating window controls — rendered LAST so their `no-drag` regions are
          accumulated after the full-width header drag regions (sidebar/chat/
          session headers). Earlier in the DOM, those overlapping drag regions
          would re-assert `drag` over these buttons and swallow their clicks
          (Electron #27149). They stay absolutely positioned, so paint order and
          layout are unchanged. */}
      <div
        data-electron-drag-region
        className="absolute h-9 z-40 flex items-center gap-1.5"
        style={{ top: bannerStackHeight, left: WINDOW_CONTROLS_INSET_PX }}
      >
        <button
          onClick={() => {
            dispatch({ type: 'TOGGLE_SIDEBAR' });
          }}
          className="p-1.5 rounded-md text-droid-text-muted/70 hover:text-droid-text hover:bg-droid-elevated/60 transition-colors"
          title={`Toggle sidebar (${formatChord(state.shortcutBindings.toggleSidebar)})`}
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Without tabs, the session's controls float at the end of the view's own top row. */}
      {!state.tabStripShown && !showUtilityPane && !fullContentRoute && (
        <div
          data-electron-drag-region
          className="absolute right-0 h-9 z-40 flex items-center gap-1 pr-3"
          style={{ top: bannerStackHeight }}
        >
          {sessionControls}
        </div>
      )}

      {state.commandPaletteOpen && (
        <Suspense fallback={<CommandPaletteSkeleton />}>
          <LazyCommandPalette />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <LazySpecWikiModal />
      </Suspense>
      {/* Watches project threads for a block that needs the user. Nothing to
          watch until a project exists, so it loads with the first one. */}
      {hasProjects && !embedded && !showWizard && (
        <Suspense fallback={null}>
          <LazyThreadAttentionNotifier />
        </Suspense>
      )}
      <Toaster />

      <AnimatePresence>{state.settingsOpen && <SettingsLazyHost />}</AnimatePresence>

      <AnimatePresence>
        {showWizard && onboard.ready && (
          <OnboardingLazyHost
            controller={onboard}
            onComplete={() => {
              setForceWizard(false);
              setBannerDismissed(false);
            }}
          />
        )}
      </AnimatePresence>
      {/* Every chat's browser page. Last, so the pane's slot is laid out before
          the pages anchored to it. */}
      {!embedded && isDesktop() && <BrowserHost />}
    </div>
  );
}

function initialUtilityPaneWidth(): number {
  if (typeof window === 'undefined') return UTILITY_PANE_DEFAULT;
  try {
    const stored = Number(
      localStorage.getItem(UTILITY_PANE_WIDTH_STORAGE_KEY) ??
        localStorage.getItem('droid-browser-pane-width'),
    );
    if (Number.isFinite(stored) && stored > 0) return clampUtilityPane(stored);
  } catch {
    /* ignore */
  }
  return clampUtilityPane(Math.min(UTILITY_PANE_DEFAULT, Math.round(window.innerWidth * 0.42)));
}

function utilityPaneMaxWidth(availableWidth?: number): number {
  if (typeof window === 'undefined') return UTILITY_PANE_MAX;
  const available = availableWidth ?? window.innerWidth;
  return Math.max(
    UTILITY_PANE_MIN,
    Math.min(UTILITY_PANE_MAX, Math.round(available - UTILITY_PANE_CONTENT_RESERVE)),
  );
}

function clampUtilityPane(width: number, availableWidth?: number): number {
  return Math.min(
    utilityPaneMaxWidth(availableWidth),
    Math.max(UTILITY_PANE_MIN, Math.round(width)),
  );
}
