import { useCallback, useState, type ReactNode } from 'react';
import { useStoreApi, useStoreDispatch } from '../../hooks/useStore';
import { closeSession } from '../../lib/commands';
import { shownSideChat, sideChatPanel } from '../../lib/sideChats';
import { utilityPanelForSession } from '../../lib/utilityPanel';
import { SideChatCloseDialog } from './SideChatCloseDialog';

/* Closing a side chat, from its own header or from its utility tab. A side
   chat on screen asks first, then is hidden at once and its runtime is closed,
   so the next question starts a fresh one. A chat still starting arrives after
   a close anyway, so its tab's Close only minimizes it to the composer pill;
   with nothing to lose, Close only takes the pane off screen. `onClosed` runs
   whenever the side chat leaves the pane. Render `dialog` anywhere: it portals
   to the body. */

interface ClosingSideChat {
  sourceAppSessionId: string;
  appSessionId: string;
}

export function useCloseSideChat(onClosed?: () => void): {
  requestClose: (sourceAppSessionId: string) => void;
  dialog: ReactNode;
} {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const [confirming, setConfirming] = useState<ClosingSideChat | null>(null);
  // Stable, because the dialog moves focus to Cancel whenever this changes.
  const cancel = useCallback(() => {
    setConfirming(null);
  }, []);

  const requestClose = (sourceAppSessionId: string) => {
    const state = store.getState();
    const { view } = sideChatPanel(state.sideChats, sourceAppSessionId);
    if (view.kind === 'starting') {
      const pane = utilityPanelForSession(state.utilityPanels, sourceAppSessionId);
      const sideTab = pane.tabs.find((tab) => tab.tool === 'side');
      if (sideTab) {
        dispatch({
          type: 'CLOSE_UTILITY_TAB',
          tabId: sideTab.id,
          appSessionId: sourceAppSessionId,
        });
        onClosed?.();
      }
      return;
    }
    const shown = shownSideChat(state.sessions, state.chatMetadata, sourceAppSessionId, view);
    if (!shown) {
      dispatch({ type: 'CLOSE_SIDE_CHAT', sourceAppSessionId });
      onClosed?.();
      return;
    }
    setConfirming({ sourceAppSessionId, appSessionId: shown.appSessionId });
  };

  const dialog = confirming && (
    <SideChatCloseDialog
      onCancel={cancel}
      onConfirm={() => {
        setConfirming(null);
        dispatch({ type: 'CLOSE_SIDE_CHAT', ...confirming });
        closeSession(confirming.appSessionId);
        onClosed?.();
      }}
    />
  );

  return { requestClose, dialog };
}
