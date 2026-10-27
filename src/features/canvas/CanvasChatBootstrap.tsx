// A Design create already owns its attachment before session.created arrives.
// This lazy bootstrap only reads that attachment, gives the canvas the design
// system its first prompt was pinned to, and opens its pane.

import { useEffect } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { settleCreatedCanvasChoice } from './designSystemChoices';
import { useOpenCanvasPane } from './openCanvasPane';

export function CanvasChatBootstrap({
  clientRef,
  appSessionId,
}: {
  clientRef: string;
  appSessionId: string;
}) {
  const dispatch = useStoreDispatch();
  const openPane = useOpenCanvasPane();

  useEffect(() => {
    let active = true;
    canvasClient.attachment(appSessionId).then(
      ({ canvasId }) => {
        if (!active) return;
        settleCreatedCanvasChoice(clientRef, canvasId);
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId, canvasId });
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId });
      },
      () => {
        if (!active) return;
        settleCreatedCanvasChoice(clientRef, null);
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        // The pane owns reading errors and its ordinary retry action.
        openPane({ appSessionId, canvasId: null });
      },
    );
    return () => {
      active = false;
    };
  }, [appSessionId, clientRef, dispatch, openPane]);

  return null;
}
