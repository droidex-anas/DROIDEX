import { useEffect } from 'react';
import type { UtilityTool } from '../lib/utilityPanel';
import { isRemoteClient } from '../lib/desktop';
import { forwardNativeBrowserShortcuts } from '../lib/nativeBrowser';
import {
  activeGrid,
  activeProduct,
  adjacentTabId,
  numberedTabId,
  type TabAction,
} from '../features/tabs/tabStrip';
import { adjacentTileId, nextSplit, type TileEdge } from '../features/tabs/tileGrid';
import {
  isTerminalInputTarget,
  isTerminalTabShortcut,
  utilityToolShortcut,
} from '../lib/keyboardShortcuts';
import {
  SHORTCUT_DEFINITIONS,
  matchesChord,
  nativeBrowserChords,
  tabNumberFromEvent,
  type ShortcutAction,
  type ShortcutBindings,
} from '../lib/shortcuts';
import { useStoreApi, useStoreDispatch } from './useStore';

interface AppKeyboardShortcutsOptions {
  embedded: boolean;
  shortcutBindings: ShortcutBindings;
  openUtilityTool: (tool: UtilityTool) => void;
  toggleUtilityPane: () => void;
}

export function useAppKeyboardShortcuts({
  embedded,
  shortcutBindings,
  openUtilityTool,
  toggleUtilityPane,
}: AppKeyboardShortcutsOptions): void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();

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
      toggleProduct: isRemoteClient()
        ? null
        : () => {
            const mode = activeProduct(store.getState()) === 'chat' ? 'design' : 'chat';
            dispatch({ type: 'SET_PRODUCT_MODE', mode });
          },
      openCommandPalette: () => {
        dispatch({ type: 'TOGGLE_COMMAND_PALETTE' });
      },
      openSettings: () => {
        dispatch({ type: 'TOGGLE_SETTINGS' });
      },
      newTab: tabAction(() => ({ type: 'OPEN_NEW_TAB', product: activeProduct(store.getState()) })),
      newDesignTab: isRemoteClient()
        ? null
        : tabAction(() => ({ type: 'OPEN_NEW_TAB', product: 'design' })),
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
        if (!perform || !matchesChord(e, shortcutBindings[action])) continue;
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
      : forwardNativeBrowserShortcuts(nativeBrowserChords(shortcutBindings), (press) => {
          handler(new KeyboardEvent('keydown', press));
        });
    return () => {
      window.removeEventListener('keydown', handler);
      stopForwarding?.();
    };
  }, [dispatch, embedded, openUtilityTool, shortcutBindings, store, toggleUtilityPane]);
}
