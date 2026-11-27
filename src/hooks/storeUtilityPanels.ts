import { isRemoteClient } from '../lib/desktop';
import { applyOpenReviewAt, clearReviewFocus, type OpenReviewAtAction } from '../lib/reviewFocus';
import {
  activateUtilityTab,
  closeUtilityTab,
  openUtilityTool,
  removeUtilityTool,
  setUtilityPanelOpen,
  updateUtilityTab,
  utilityPanelForSession,
  type UtilityTool,
} from '../lib/utilityPanel';
import type { BrowserState } from '@droidex/protocol';
import type { DiffScope } from '../types/vcs';
import { clearDesignMode, setDesignMode, toggleDesignMode } from './designModeState';
import type { DiffViewMode } from './persistedUiPreferences';
import type { AppState } from './useStore';

export type UtilityPanelsAction =
  | { type: 'SET_RIGHT_PANEL'; open: boolean }
  | {
      type: 'OPEN_UTILITY_TOOL';
      tool: UtilityTool;
      // The chat the pane belongs to, when it is not the one on screen.
      appSessionId?: string;
      tabId?: string;
      terminalId?: string;
      cwd?: string;
      filePath?: string;
      prNumber?: number;
      label?: string;
      agentId?: string;
      threadId?: string;
      canvasId?: string | null;
      frameId?: string | null;
      designSystemId?: string | null;
      designSystemVersion?: number | null;
    }
  | { type: 'CLOSE_UTILITY_TAB'; tabId: string; appSessionId?: string }
  | { type: 'ACTIVATE_UTILITY_TAB'; tabId: string }
  | {
      type: 'UPDATE_UTILITY_TAB';
      tabId: string;
      appSessionId?: string;
      terminalId?: string;
      cwd?: string;
      filePath?: string;
      label?: string;
      agentId?: string | null;
      threadId?: string | null;
    }
  | { type: 'SET_UTILITY_PANEL_OPEN'; open: boolean }
  | { type: 'SET_REVIEW_OPEN'; open: boolean }
  | { type: 'SET_REVIEW_SCOPE'; scope: DiffScope }
  | OpenReviewAtAction
  | { type: 'CLEAR_REVIEW_FOCUS' }
  | { type: 'SET_DIFF_VIEW'; mode: DiffViewMode }
  | { type: 'SET_BROWSER_OPEN'; open: boolean }
  | { type: 'BROWSER_UPDATED'; browser: BrowserState }
  | {
      type: 'BROWSER_NAVIGATED';
      appSessionId: string;
      browserSessionId: string;
      url: string;
      canGoBack?: boolean;
      canGoForward?: boolean;
    }
  | { type: 'BROWSER_CLOSED'; appSessionId: string; keepPane?: boolean }
  | { type: 'BROWSER_ERROR'; appSessionId?: string; message: string }
  | { type: 'TOGGLE_DESIGN_MODE'; appSessionId: string }
  | { type: 'SET_DESIGN_MODE'; appSessionId: string; open: boolean };

function activeBrowserKey(state: AppState): string | undefined {
  if (!state.activeAppSessionId) return undefined;
  // Browser state and open-keys are keyed by the stable app session id
  // (`appSessionId`), matching the backend; the provider session is swapped by
  // compaction and would desync the open state from the backend's updates.
  const sessions: Partial<AppState['sessions']> = state.sessions;
  return sessions[state.activeAppSessionId]?.appSessionId ?? state.activeAppSessionId;
}

function closeActiveUtilityPanel(state: AppState): AppState {
  const appSessionId = state.activeAppSessionId;
  if (!appSessionId) return state;
  const current = utilityPanelForSession(state.utilityPanels, appSessionId);
  const panel = setUtilityPanelOpen(current, false);
  return panel === current
    ? state
    : { ...state, utilityPanels: { ...state.utilityPanels, [appSessionId]: panel } };
}

export function reduceUtilityPanels(state: AppState, action: UtilityPanelsAction): AppState {
  switch (action.type) {
    case 'SET_RIGHT_PANEL':
      return action.open
        ? closeActiveUtilityPanel({ ...state, rightPanelOpen: true })
        : { ...state, rightPanelOpen: false };

    case 'OPEN_UTILITY_TOOL': {
      const appSessionId = action.appSessionId ?? state.activeAppSessionId;
      if (!appSessionId) return state;
      if (action.tool === 'canvas') {
        // The board's previews are the laptop window's own views, out of a Remote browser's reach.
        if (isRemoteClient()) return state;
        if (state.listConfirmedSessionIds !== null && !(appSessionId in state.sessions))
          return state;
      }
      const panel = openUtilityTool(
        state.utilityPanels[appSessionId],
        action.tool,
        () => action.tabId ?? `${action.tool}:${appSessionId}`,
        {
          terminalId: action.terminalId,
          cwd: action.cwd,
          filePath: action.filePath,
          prNumber: action.prNumber,
          label: action.label,
          agentId: action.agentId,
          threadId: action.threadId,
          canvasId: action.canvasId,
          frameId: action.frameId,
          designSystemId: action.designSystemId,
          designSystemVersion: action.designSystemVersion,
        },
      );
      return {
        ...state,
        // Context is one app-wide panel; a background chat's pane must not close it.
        rightPanelOpen: appSessionId === state.activeAppSessionId ? false : state.rightPanelOpen,
        utilityPanels: { ...state.utilityPanels, [appSessionId]: panel },
        reviewOpenAppSessionId:
          action.tool === 'review' ? appSessionId : state.reviewOpenAppSessionId,
      };
    }

    case 'CLOSE_UTILITY_TAB': {
      const appSessionId = action.appSessionId ?? state.activeAppSessionId;
      if (!appSessionId) return state;
      const panels: Partial<AppState['utilityPanels']> = state.utilityPanels;
      const current = panels[appSessionId];
      const closing = current?.tabs.find((tab) => tab.id === action.tabId);
      const panel = closeUtilityTab(current, action.tabId);
      if (panel === current) return state;
      return {
        ...state,
        utilityPanels: { ...state.utilityPanels, [appSessionId]: panel },
        reviewOpenAppSessionId:
          closing?.tool === 'review' && state.reviewOpenAppSessionId === appSessionId
            ? null
            : state.reviewOpenAppSessionId,
        reviewFocusPath: closing?.tool === 'review' ? null : state.reviewFocusPath,
        reviewFocusChange: closing?.tool === 'review' ? null : state.reviewFocusChange,
      };
    }

    case 'ACTIVATE_UTILITY_TAB': {
      const appSessionId = state.activeAppSessionId;
      if (!appSessionId) return state;
      const current = state.utilityPanels[appSessionId];
      const panel = activateUtilityTab(current, action.tabId);
      if (panel === current) return state;
      return {
        ...state,
        rightPanelOpen: false,
        utilityPanels: { ...state.utilityPanels, [appSessionId]: panel },
      };
    }

    case 'UPDATE_UTILITY_TAB': {
      const appSessionId = action.appSessionId ?? state.activeAppSessionId;
      if (!appSessionId) return state;
      const current = state.utilityPanels[appSessionId];
      const panel = updateUtilityTab(current, action.tabId, {
        terminalId: action.terminalId,
        cwd: action.cwd,
        filePath: action.filePath,
        label: action.label,
        agentId: action.agentId,
        threadId: action.threadId,
      });
      if (panel === current) return state;
      return {
        ...state,
        utilityPanels: { ...state.utilityPanels, [appSessionId]: panel },
      };
    }

    case 'SET_UTILITY_PANEL_OPEN': {
      const appSessionId = state.activeAppSessionId;
      if (!appSessionId) return state;
      const current = utilityPanelForSession(state.utilityPanels, appSessionId);
      const panel = setUtilityPanelOpen(current, action.open);
      if (panel === current && (!action.open || !state.rightPanelOpen)) return state;
      return {
        ...state,
        rightPanelOpen: action.open ? false : state.rightPanelOpen,
        utilityPanels: { ...state.utilityPanels, [appSessionId]: panel },
      };
    }

    case 'SET_REVIEW_OPEN':
      // Closing while already closed AND no pending focus is a true no-op; bail
      // before allocating a new state object so subscribers don't re-render. The
      // path and captured-change checks are essential: a close dispatched when
      // the pane is already shut but a focus request is still pending would
      // otherwise skip the clear and leave stale focus to fire on the next open.
      if (
        !action.open &&
        state.reviewOpenAppSessionId === null &&
        state.reviewFocusPath === null &&
        state.reviewFocusChange === null &&
        !utilityPanelForSession(state.utilityPanels, state.activeAppSessionId).tabs.some(
          (tab) => tab.tool === 'review',
        )
      )
        return state;
      // Scope the open state to the active session so it never leaks into the
      // next chat; switching back to this session restores it.
      if (action.open && state.activeAppSessionId) {
        const appSessionId = state.activeAppSessionId;
        return {
          ...state,
          rightPanelOpen: false,
          reviewOpenAppSessionId: appSessionId,
          utilityPanels: {
            ...state.utilityPanels,
            [appSessionId]: openUtilityTool(
              state.utilityPanels[appSessionId],
              'review',
              () => `review:${appSessionId}`,
            ),
          },
        };
      }
      return {
        ...state,
        reviewOpenAppSessionId: null,
        reviewFocusPath: null,
        reviewFocusChange: null,
        utilityPanels: state.activeAppSessionId
          ? {
              ...state.utilityPanels,
              [state.activeAppSessionId]: removeUtilityTool(
                state.utilityPanels[state.activeAppSessionId],
                'review',
              ),
            }
          : state.utilityPanels,
      };

    case 'SET_REVIEW_SCOPE':
      return { ...state, reviewScope: action.scope };

    case 'OPEN_REVIEW_AT': {
      // Open the Review pane for the active session at a given scope, optionally
      // asking it to jump to a specific file once the diff list has loaded.
      const focused = applyOpenReviewAt(state, action);
      const appSessionId = state.activeAppSessionId;
      if (!appSessionId) {
        return { ...focused, reviewScope: action.scope };
      }
      return {
        ...focused,
        rightPanelOpen: false,
        reviewOpenAppSessionId: appSessionId,
        reviewScope: action.scope,
        utilityPanels: {
          ...state.utilityPanels,
          [appSessionId]: openUtilityTool(
            state.utilityPanels[appSessionId],
            'review',
            () => `review:${appSessionId}`,
          ),
        },
      };
    }

    case 'CLEAR_REVIEW_FOCUS':
      return clearReviewFocus(state);

    case 'SET_DIFF_VIEW':
      return { ...state, diffView: action.mode };

    case 'SET_BROWSER_OPEN': {
      const key = activeBrowserKey(state);
      if (!key) return state;
      return {
        ...state,
        rightPanelOpen: action.open ? false : state.rightPanelOpen,
        utilityPanels: {
          ...state.utilityPanels,
          [key]: action.open
            ? openUtilityTool(state.utilityPanels[key], 'browser', () => `browser:${key}`)
            : removeUtilityTool(state.utilityPanels[key], 'browser'),
        },
      };
    }

    case 'BROWSER_UPDATED': {
      if (!action.browser.appSessionId) return state;
      const appSessionId = action.browser.appSessionId;
      // Only records the page: agent work never opens or switches the pane.
      return {
        ...state,
        browsers: { ...state.browsers, [appSessionId]: action.browser },
        browserErrors: Object.fromEntries(
          Object.entries(state.browserErrors).filter(([id]) => id !== appSessionId),
        ),
      };
    }

    case 'BROWSER_NAVIGATED': {
      const browsers: Partial<AppState['browsers']> = state.browsers;
      const browser = browsers[action.appSessionId];
      if (!browser) return state;
      if (browser.browserSessionId !== action.browserSessionId) return state;
      return {
        ...state,
        browsers: {
          ...state.browsers,
          [action.appSessionId]: {
            ...browser,
            url: action.url,
            canGoBack: action.canGoBack ?? browser.canGoBack,
            canGoForward: action.canGoForward ?? browser.canGoForward,
          },
        },
      };
    }

    case 'BROWSER_CLOSED':
      // Full close: drop the session's browser, design mode, and open flag so a
      // later reopen starts fresh (and it is excluded from persistence). A
      // browser closed with its chat's runtime leaves the pane open.
      return {
        ...state,
        browsers: Object.fromEntries(
          Object.entries(state.browsers).filter(([id]) => id !== action.appSessionId),
        ),
        browserErrors: Object.fromEntries(
          Object.entries(state.browserErrors).filter(([id]) => id !== action.appSessionId),
        ),
        designModes: clearDesignMode(state.designModes, action.appSessionId),
        utilityPanels: action.keepPane
          ? state.utilityPanels
          : {
              ...state.utilityPanels,
              [action.appSessionId]: removeUtilityTool(
                state.utilityPanels[action.appSessionId],
                'browser',
              ),
            },
      };

    case 'BROWSER_ERROR':
      if (!action.appSessionId) return { ...state, browserGlobalError: action.message };
      return {
        ...state,
        browserErrors: { ...state.browserErrors, [action.appSessionId]: action.message },
      };

    case 'TOGGLE_DESIGN_MODE':
      return {
        ...state,
        designModes: toggleDesignMode(state.designModes, action.appSessionId),
      };

    case 'SET_DESIGN_MODE':
      return {
        ...state,
        designModes: setDesignMode(state.designModes, action.appSessionId, action.open),
      };
  }
}
