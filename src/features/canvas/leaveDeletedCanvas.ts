// What deleting a whole canvas (spec §7) leaves in this window: its chats have
// no canvas, and a canvas tab on it has nothing left to show.

import { useCallback } from 'react';
import { useStoreApi, useStoreDispatch } from '../../hooks/useStore';
import { utilityPanelForSession } from '../../lib/utilityPanel';
import type { CanvasRemovalPreview } from './protocol';

/** Closes the chat's canvas tab; a pane holds at most one. */
export function useCloseCanvasTab(): (appSessionId: string) => void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  return useCallback(
    (appSessionId: string) => {
      const pane = utilityPanelForSession(store.getState().utilityPanels, appSessionId);
      const canvasTab = pane.tabs.find((tab) => tab.tool === 'canvas');
      if (canvasTab) dispatch({ type: 'CLOSE_UTILITY_TAB', tabId: canvasTab.id, appSessionId });
    },
    [dispatch, store],
  );
}

/**
 * After the user deletes a canvas from `appSessionId`'s pane: its chats are left
 * unattached and that pane closes. The window returns to the Design home only
 * while that chat is still on screen, because the user may have moved to
 * another chat while the deletion ran.
 */
export function useLeaveDeletedCanvas(): (
  appSessionId: string,
  removed: CanvasRemovalPreview,
) => void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const closeCanvasTab = useCloseCanvasTab();
  return useCallback(
    (appSessionId: string, removed: CanvasRemovalPreview) => {
      for (const attached of removed.attachedAppSessionIds)
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId: attached, canvasId: null });
      closeCanvasTab(appSessionId);
      const state = store.getState();
      if (state.activeAppSessionId !== appSessionId) return;
      if (state.productMode === 'design')
        dispatch({ type: 'START_CHAT', cwd: '', executionMode: 'local' });
      else dispatch({ type: 'SET_PRODUCT_MODE', mode: 'design' });
    },
    [closeCanvasTab, dispatch, store],
  );
}
