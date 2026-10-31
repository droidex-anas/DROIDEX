// A Design create already owns its attachment before session.created arrives.
// This lazy bootstrap only reads that attachment, gives the canvas the design
// system its first prompt was pinned to and the library frame it started from,
// and opens its pane.

import { useEffect } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';
import { toast } from '../../lib/toast';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import { settleCreatedCanvasChoice } from './designSystemChoices';
import { libraryFrame } from './libraryRequests';
import { takeCreatedCanvasSeed, type CreatedCanvasSeed } from './librarySeed';
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
        const seed = takeCreatedCanvasSeed(clientRef);
        if (seed && canvasId !== null) void placeSeed(appSessionId, canvasId, seed);
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId, canvasId });
        dispatch({ type: 'CANVAS_CHAT_SETTLED', appSessionId });
        openPane({ appSessionId, canvasId });
      },
      () => {
        if (!active) return;
        settleCreatedCanvasChoice(clientRef, null);
        takeCreatedCanvasSeed(clientRef);
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

/** The board shows the frame when its change arrives; only a failure needs saying. */
async function placeSeed(appSessionId: string, canvasId: string, seed: CreatedCanvasSeed) {
  try {
    await canvasClient.createFrames(appSessionId, canvasId, {
      mutationId: seed.mutationId,
      frames: [libraryFrame(seed.item)],
    });
  } catch (error) {
    toast.error(
      `“${seed.item.name}” was not placed on the new canvas. ${canvasMessage(error)} Add it with From library in the canvas menu.`,
    );
  }
}
