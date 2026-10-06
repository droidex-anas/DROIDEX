// The one way the Canvas pane opens. It is deliberately absent from the
// utility-tool picker: an artifact card's Open (Task 6a) and the design entry
// point reach it through here, so the canvas and the frame the caller means
// travel with the request instead of being rediscovered by the pane.
//
// Importing this costs nothing: the pane itself is a lazy surface, and nothing
// here touches it.

import { useCallback } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';

export interface CanvasPaneTarget {
  appSessionId: string;
  /** The canvas to show, or null to let the pane read the chat's attachment. */
  canvasId: string | null;
  /** The frame to focus once the board can focus one (Task 5d). */
  frameId?: string;
}

export function useOpenCanvasPane(): (target: CanvasPaneTarget) => void {
  const dispatch = useStoreDispatch();
  return useCallback(
    ({ appSessionId, canvasId, frameId }: CanvasPaneTarget) => {
      dispatch({
        type: 'BATCH',
        actions: [
          // A caller that names the canvas saves the pane a round trip; one that
          // does not leaves the attachment unclaimed rather than asserting none.
          ...(canvasId === null
            ? []
            : [{ type: 'SET_CANVAS_ATTACHMENT' as const, appSessionId, canvasId }]),
          {
            type: 'OPEN_UTILITY_TOOL' as const,
            tool: 'canvas' as const,
            appSessionId,
            ...(frameId === undefined ? {} : { frameId }),
          },
        ],
      });
    },
    [dispatch],
  );
}
