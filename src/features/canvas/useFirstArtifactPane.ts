// A chat's first Canvas create opens the board beside it, docked on the frame
// it made (spec §4). Only a live append counts: `event.appended` is what a
// running turn emits, and history replay never sends it, so a reloaded chat
// does not reopen a pane its user closed.
//
// It lives on the entry because the append has to be heard when it happens;
// the pane itself stays a lazy surface.

import { useEffect } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';
import { bridge } from '../../lib/bridge';
import type { TranscriptEvent } from '../../types/bridge';
import { useOpenCanvasPane, type CanvasPaneTarget } from './openCanvasPane';

export function useFirstArtifactPane(enabled: boolean): void {
  const dispatch = useStoreDispatch();
  const openPane = useOpenCanvasPane();
  useEffect(() => {
    if (!enabled) return undefined;
    return bridge.subscribe((event) => {
      if (event.type !== 'event.appended') return;
      const target = firstArtifactTarget(event.event);
      if (!target) return;
      dispatch({
        type: 'SET_CANVAS_ATTACHMENT',
        appSessionId: target.appSessionId,
        canvasId: target.canvasId,
      });
      openPane(target);
    });
  }, [dispatch, enabled, openPane]);
}

function firstArtifactTarget(
  event: TranscriptEvent,
): (CanvasPaneTarget & { canvasId: string }) | null {
  const activity = event.canvasActivity;
  if (event.kind !== 'tool_result' || activity?.state !== 'completed') return null;
  if (!activity.firstArtifact || !activity.canvasId) return null;
  const frameId = activity.designIds.at(0);
  return {
    appSessionId: event.appSessionId,
    canvasId: activity.canvasId,
    ...(frameId ? { frameId } : {}),
  };
}
