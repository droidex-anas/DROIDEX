import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useStoreApi, useStoreDispatch, type AppState } from '../../hooks/useStore';
import { isChatHidden } from '../../lib/chatMetadata';
import { closeSession } from '../../lib/commands';
import { sessionIsLive } from '../../lib/sessions';
import { isSideChat, shownSideChat, sideChatPanel } from '../../lib/sideChats';
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

function revivedSideChatIds(state: Pick<AppState, 'sessions' | 'chatMetadata'>): string[] {
  const ids: string[] = [];
  for (const session of Object.values(state.sessions)) {
    if (!isSideChat(session) || !sessionIsLive(session)) continue;
    if (isChatHidden(state.chatMetadata[session.appSessionId])) ids.push(session.appSessionId);
  }
  return ids;
}

/* A side chat closed just after it was made can still start its first turn:
   the sidecar sends a native copy's first prompt only once the copy and its
   model are ready, and a close that lands before the copy has a runtime has
   nothing to stop. So a closed side chat that turns live is closed again.
   Mount once. */
export function useCloseRevivedSideChats(): void {
  const store = useStoreApi();
  useEffect(() => {
    let checked: Pick<AppState, 'sessions' | 'chatMetadata'> | null = null;
    // A closed chat stays deleted, so one close each is enough.
    const closed = new Set<string>();
    const closeRevived = () => {
      const { sessions, chatMetadata } = store.getState();
      if (checked?.sessions === sessions && checked.chatMetadata === chatMetadata) return;
      checked = { sessions, chatMetadata };
      for (const appSessionId of revivedSideChatIds(checked)) {
        if (closed.has(appSessionId)) continue;
        closed.add(appSessionId);
        closeSession(appSessionId);
      }
    };
    closeRevived();
    return store.subscribe(closeRevived);
  }, [store]);
}
