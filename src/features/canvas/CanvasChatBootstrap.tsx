// Gives the chat a design draft just created its canvas, then opens the board
// beside it (spec §4). It renders nothing: the app mounts it only while a
// request is waiting for its chat, which is also what keeps this out of the
// entry bundle.

import { useEffect, useRef } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { attachCanvasToChat } from './canvasChats';
import { useOpenCanvasPane } from './openCanvasPane';

export function CanvasChatBootstrap({
  appSessionId,
  canvasId,
}: {
  appSessionId: string;
  /** Null mints a canvas for this chat; otherwise it joins that canvas. */
  canvasId: string | null;
}) {
  const dispatch = useStoreDispatch();
  const openPane = useOpenCanvasPane();
  // One attempt per chat: the request stays in the store until it settles, and
  // a re-render must not commit a second canvas.
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (started.current === appSessionId) return;
    started.current = appSessionId;
    let active = true;
    attachCanvasToChat(canvasClient, appSessionId, canvasId)
      .then((attached) => {
        if (!active) return;
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId, canvasId: attached });
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId: attached });
      })
      .catch(() => {
        if (!active) return;
        // The pane's own empty state is the recovery: it offers Create and
        // Open saved canvas for exactly this chat.
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId: null });
      });
    return () => {
      active = false;
    };
  }, [appSessionId, canvasId, dispatch, openPane]);

  return null;
}
