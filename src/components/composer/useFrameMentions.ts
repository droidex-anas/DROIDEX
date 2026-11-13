// The `@` menu offers the frames from this chat's attached canvas, and choosing
// a row tags it in the next prompt. The canvas is watched only while the mention
// menu is open, so a chat whose pane is closed holds no watch on it.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CanvasClient } from '../../features/canvas/client';
import { toggleFramePins, untagsFrames, useFramePins } from '../../features/canvas/framePins';
import type { CanvasFrame } from '../../features/canvas/protocol';
import { frameRowKey } from './menuItems';

const NO_FRAMES: readonly CanvasFrame[] = [];

// The client comes with the canvas code rather than the entry. A chat on a
// canvas loads it up front, so the menu has it by the time `@` is typed.
let loadedClient: CanvasClient | null = null;

// A failed load leaves the menu without frames; the next subscription loads again.
async function loadCanvasClient(): Promise<CanvasClient | null> {
  try {
    const { canvasClient } = await import('../../features/canvas/canvasClient');
    loadedClient = canvasClient;
    return canvasClient;
  } catch {
    return null;
  }
}

export function useFrameMentions(
  appSessionId: string | null,
  canvasId: string | null,
  mentioning: boolean,
) {
  const watched = appSessionId !== null && mentioning ? canvasId : null;
  useEffect(() => {
    if (canvasId !== null) void loadCanvasClient();
  }, [canvasId]);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (watched === null) return () => undefined;
      let unsubscribe: (() => void) | null = null;
      let closed = false;
      void loadCanvasClient().then((client) => {
        if (closed || client === null) return;
        unsubscribe = client.subscribeCanvas(watched, listener);
        // React read the snapshot before the client loaded; a board it already holds shows now.
        listener();
      });
      return () => {
        closed = true;
        unsubscribe?.();
      };
    },
    [watched],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    watched === null ? null : (loadedClient?.snapshotOf(watched) ?? null),
  );
  const pins = useFramePins(appSessionId);
  const taggedRowKeys = useMemo(
    () => pins.filter((pin) => pin.canvasId === canvasId).map((pin) => frameRowKey(pin.designId)),
    [pins, canvasId],
  );
  return {
    frames: snapshot?.frames ?? NO_FRAMES,
    /** The rows of frames the draft already carries, so they read as staged. */
    taggedRowKeys,
    /**
     * Tags the frame beside the ones the draft carries. A tagged frame stays, as
     * a staged file or skill does; its chip takes it off.
     */
    tag: (frame: CanvasFrame) => {
      if (appSessionId === null || watched === null || untagsFrames(pins, watched, [frame])) return;
      toggleFramePins(appSessionId, watched, [frame]);
    },
  };
}
