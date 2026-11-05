// The frames `@` offers a chat on a canvas: those of its attached canvas, which
// running a row tags in the next prompt. The canvas is watched only while the
// mention menu is open, so a chat whose pane is closed holds no watch on it.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { canvasClient } from '../../features/canvas/canvasClient';
import { addFramePins, useFramePins } from '../../features/canvas/framePins';
import type { CanvasFrame } from '../../features/canvas/protocol';
import { frameRowKey } from './menuItems';

const NO_FRAMES: readonly CanvasFrame[] = [];

export function useFrameMentions(
  appSessionId: string | null,
  canvasId: string | null,
  mentioning: boolean,
) {
  const watched = appSessionId !== null && mentioning ? canvasId : null;
  const subscribe = useCallback(
    (listener: () => void) =>
      watched === null ? () => undefined : canvasClient.subscribeCanvas(watched, listener),
    [watched],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    watched === null ? null : canvasClient.snapshotOf(watched),
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
    /** Tags the frame beside the ones the draft carries; a tagged frame stays tagged. */
    tag: (frame: CanvasFrame) => {
      if (appSessionId !== null && watched !== null) addFramePins(appSessionId, watched, [frame]);
    },
  };
}
