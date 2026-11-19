// Keyboard focus over the frames: their one tab stop, handing focus to a
// frame's label, and the board's public focusFrame, which centres a frame and
// gives the board focus once that frame is on it, and showFrame, which selects
// and reveals it while the keyboard stays where it is.

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
  const order = readingOrder(drawn).map((placed) => placed.designId);
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
    reveal(rectFor(frame));
  };

  // A focus asked for before its frame arrived waits for it rather than being
  // dropped: Open on an artifact card reaches the pane before the snapshot does.
  const [request, setRequest] = useState<{ designId: string; kind: 'focus' | 'show' } | null>(null);
  useEffect(() => {
    if (request === null) return;
    const target = frames.find((frame) => frame.designId === request.designId);
    if (!target) return;
    setRequest(null);
    // The acknowledged rect, not an optimistic hold: it shows where the
    // canvas says the frame is.
    if (request.kind === 'focus') {
      board.current?.focus({ preventScroll: true });
      fitTo([target.rect]);
    } else reveal(target.rect);
    dispatch({ type: 'pick', designId: request.designId, additive: false });
  }, [board, dispatch, fitTo, frames, request, reveal]);
  const focusFrame = useCallback((designId: string) => {
    setRequest({ designId, kind: 'focus' });
  }, []);
  const showFrame = useCallback((designId: string) => {
    setRequest({ designId, kind: 'show' });
  }, []);

  return { focusedId, order, tabStopId, focusFrame, showFrame, focusLabel, onFocusLabel };
}
