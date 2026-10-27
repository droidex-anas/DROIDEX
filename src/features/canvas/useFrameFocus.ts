// Keyboard focus over the frames: their one tab stop, handing focus to a
// frame's label, and the board's public focusFrame, which centres a frame and
// gives the board focus once that frame is on it.

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { readingOrder } from './boardKeys';
import type { PlacedFrame } from './canvasGeometry';
import type { BoardInteractionEvent } from './canvasState';
import type { CanvasFrame, FrameRect } from './protocol';

export function useFrameFocus({
  board,
  frames,
  drawn,
  selectedFrameIds,
  dispatch,
  fitTo,
  reveal,
  rectFor,
}: {
  board: RefObject<HTMLElement | null>;
  frames: readonly CanvasFrame[];
  /** Where every frame is drawn, which sets the reading order. */
  drawn: readonly PlacedFrame[];
  selectedFrameIds: readonly string[];
  dispatch: (event: BoardInteractionEvent) => void;
  fitTo: (rects: readonly FrameRect[]) => void;
  reveal: (rect: FrameRect) => void;
  rectFor: (frame: CanvasFrame) => FrameRect;
}) {
  // The frames share one tab stop: the label focus last rested on, else the
  // selection, else the first frame a reader meets.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const order = readingOrder(drawn);
  const tabStopId = [focusedId, selectedFrameIds.at(0), order.at(0)].find(
    (designId) => designId != null && order.includes(designId),
  );
  const focusLabel = useCallback(
    (designId: string) => {
      board.current
        ?.querySelector<HTMLElement>(
          `[data-design-frame="${CSS.escape(designId)}"] [data-frame-header]`,
        )
        ?.focus({ preventScroll: true });
    },
    [board],
  );
  const onFocusLabel = (frame: CanvasFrame) => {
    setFocusedId(frame.designId);
    // A focused label must not scroll the clipped board under its transform.
    if (board.current) board.current.scrollTop = board.current.scrollLeft = 0;
    reveal(rectFor(frame));
  };

  // A focus asked for before its frame arrived waits for it rather than being
  // dropped: Open on an artifact card reaches the pane before the snapshot does.
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  useEffect(() => {
    if (focusRequest === null) return;
    const target = frames.find((frame) => frame.designId === focusRequest);
    if (!target) return;
    setFocusRequest(null);
    board.current?.focus({ preventScroll: true });
    // The acknowledged rect, not an optimistic hold: focus shows where the
    // canvas says the frame is.
    fitTo([target.rect]);
    dispatch({ type: 'pick', designId: focusRequest, additive: false });
  }, [board, dispatch, fitTo, focusRequest, frames]);

  return { focusedId, order, tabStopId, focusFrame: setFocusRequest, focusLabel, onFocusLabel };
}
