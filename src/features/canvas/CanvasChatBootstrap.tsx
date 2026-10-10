// A Design create already owns its attachment before session.created arrives.
// This lazy bootstrap only reads that attachment and opens its pane.

import { useEffect } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { useOpenCanvasPane } from './openCanvasPane';

export function CanvasChatBootstrap({ appSessionId }: { appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const openPane = useOpenCanvasPane();

  useEffect(() => {
    let active = true;
    canvasClient.attachment(appSessionId).then(
      ({ canvasId }) => {
        if (!active) return;
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId, canvasId });
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId });
      },
      () => {
        if (!active) return;
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        // The pane owns reading errors and its ordinary retry action.
        openPane({ appSessionId, canvasId: null });
      },
    );
    return () => {
      active = false;
    };
  }, [appSessionId, dispatch, openPane]);

  return null;
}
