// Gives the chat a design draft just created its canvas, then opens the board
// beside it (spec §4). It renders nothing: the app mounts it only while a
// request is waiting for its chat, which is also what keeps this out of the
// entry bundle.

import { useEffect } from 'react';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { acknowledgeAttachment, attachCanvasToChat, provisionalCanvasName } from './canvasChats';
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
  // The prompt that started this chat is what names its canvas until the first
  // design does (spec §4).
  const goal = useStoreSelector((current) =>
    appSessionId in current.sessions ? current.sessions[appSessionId].goal : '',
  );

  useEffect(() => {
    // `canvasChats` owns the operation and its retained mutation ID, so an
    // effect replayed by StrictMode or a remount joins the request already in
    // flight rather than starting a second canvas. Only the handlers are tied
    // to this attempt; the operation itself outlives them.
    let active = true;
    attachCanvasToChat(canvasClient, appSessionId, {
      canvasId,
      name: provisionalCanvasName(goal),
    })
      .then((attached) => {
        if (!active) return;
        acknowledgeAttachment(appSessionId);
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId, canvasId: attached });
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId: attached });
      })
      .catch(() => {
        if (!active) return;
        // The operation stays recorded, so the pane's recovery replays this
        // same create or attach instead of offering a fresh one.
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId: null });
      });
    return () => {
      active = false;
    };
  }, [appSessionId, canvasId, dispatch, goal, openPane]);

  return null;
}
