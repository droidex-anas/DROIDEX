// Every layout write the board makes, and the transient rects it draws before
// one is acknowledged. A hand gesture — moving a frame or resizing it — stays
// local until the pointer is released; a nudge, an align and a distribute are
// already finished when they arrive. All four land on one `arrangeFrames` call
// carrying the layout version each frame was read at, so a frame a remote chat
// moved in the meantime is refused rather than overwritten.
//
// An arrange never touches source or revisions. A refused one drops the
// optimistic rect, leaves the acknowledged one on screen and names the failure;
// nothing the user wrote is at stake either way.

import { useCallback, useEffect, useRef, useState } from 'react';
import { reduceFrameDrag, type FrameDrag, type FrameHandle, type Point } from './canvasGeometry';
import type { ArrangeFramesInput, CanvasFrame, FrameRect } from './protocol';

/** One frame's new rect and the layout version it was read at. */
export type FramePlacement = ArrangeFramesInput['frames'][number];

export interface FrameLayout {
  /** Where a frame is drawn: under the hand, awaiting an answer, or acknowledged. */
  rectOf: (frame: CanvasFrame) => FrameRect;
  /** The frame a hand gesture is holding, if one is. */
  heldDesignId: string | null;
  /** Takes hold of a frame. Answers false when another gesture already has one. */
  hold: (frame: CanvasFrame, handle: FrameHandle, pointerId: number, origin: Point) => boolean;
  move: (pointerId: number, pointer: Point, scale: number) => void;
  /** Releases the hand, committing the rect it left the frame at, once. */
  release: (pointerId: number, pointer: Point | null, scale: number) => void;
  /** Ends the gesture without writing anything. */
  abandon: () => void;
  /** One layout write for frames the user has already finished placing. */
  place: (placements: FramePlacement[]) => void;
  error: string;
}

/** A committed rect the sidecar has not acknowledged yet. */
interface PendingRect {
  rect: FrameRect;
  /** The layout version the commit expected; anything newer is the answer. */
  afterLayoutVersion: number;
}

/** The rects drawn for commits still in flight, by design ID. */
export type PendingRects = ReadonlyMap<string, PendingRect>;

export const NO_PENDING_RECTS: PendingRects = new Map();

export type PendingRectEvent =
  | { type: 'commit'; placements: FramePlacement[] }
  /** The snapshot the sidecar has since published. */
  | { type: 'acknowledged'; frames: readonly CanvasFrame[] }
  /** The commit the sidecar refused, so its rects are no longer anybody's. */
  | { type: 'refused'; placements: FramePlacement[] };

/**
 * The optimistic rects the board still draws. This is the whole of the compare-
 * and-set contract on the renderer's side: a commit is drawn where the user left
 * it, a layout version newer than the one it expected is the sidecar's answer
 * whatever rect that answer settled on, and a refusal drops only the rects of
 * the commit that was refused. A frame the canvas has lost keeps nothing.
 */
export function reducePendingRects(pending: PendingRects, event: PendingRectEvent): PendingRects {
  switch (event.type) {
    case 'commit': {
      const next = new Map(pending);
      for (const { designId, rect, expectedLayoutVersion } of event.placements)
        next.set(designId, { rect, afterLayoutVersion: expectedLayoutVersion });
      return next;
    }
    case 'acknowledged': {
      const next = new Map<string, PendingRect>();
      for (const [designId, entry] of pending) {
        const published = event.frames.find((frame) => frame.designId === designId)?.layoutVersion;
        if (published !== undefined && published <= entry.afterLayoutVersion)
          next.set(designId, entry);
      }
      return next.size === pending.size ? pending : next;
    }
    case 'refused': {
      const next = new Map(pending);
      // A second gesture may already have replaced one of these rects; only the
      // refused commit's own are dropped.
      for (const { designId, rect } of event.placements)
        if (next.get(designId)?.rect === rect) next.delete(designId);
      return next.size === pending.size ? pending : next;
    }
  }
}

export function useFrameLayout(
  frames: readonly CanvasFrame[],
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>,
): FrameLayout {
  const [held, setHeld] = useState<{ designId: string; rect: FrameRect } | null>(null);
  const [pending, setPending] = useState(NO_PENDING_RECTS);
  const [error, setError] = useState('');
  const gesture = useRef<FrameDrag | null>(null);

  const rectOf = useCallback(
    (frame: CanvasFrame) => {
      if (held?.designId === frame.designId) return held.rect;
      return pending.get(frame.designId)?.rect ?? frame.rect;
    },
    [held, pending],
  );

  const commit = useCallback(
    (placements: FramePlacement[]) => {
      if (placements.length === 0) return;
      setPending((current) => reducePendingRects(current, { type: 'commit', placements }));
      setError('');
      onArrangeFrames({ mutationId: crypto.randomUUID(), frames: placements }).catch(
        (failure: unknown) => {
          // The snapshot's rects are authoritative again, so the frames return
          // to them.
          setPending((current) => reducePendingRects(current, { type: 'refused', placements }));
          setError(layoutFailure(failure));
        },
      );
    },
    [onArrangeFrames],
  );

  const hold = useCallback(
    (frame: CanvasFrame, handle: FrameHandle, pointerId: number, origin: Point) => {
      if (gesture.current !== null) return false;
      // The gesture starts from where the user sees the frame, which is not the
      // snapshot's rect while an earlier commit is still unacknowledged.
      const rect = pending.get(frame.designId)?.rect ?? frame.rect;
      gesture.current = {
        designId: frame.designId,
        pointerId,
        handle,
        expectedLayoutVersion: frame.layoutVersion,
        origin,
        startRect: rect,
        rect,
      };
      setHeld({ designId: frame.designId, rect });
      return true;
    },
    [pending],
  );

  const move = useCallback((pointerId: number, pointer: Point, scale: number) => {
    const running = gesture.current;
    if (running === null) return;
    const stepped = reduceFrameDrag(running, { type: 'move', pointerId, pointer, scale }).drag;
    if (stepped === null || stepped === running) return;
    gesture.current = stepped;
    setHeld({ designId: stepped.designId, rect: stepped.rect });
  }, []);

  const release = useCallback(
    (pointerId: number, pointer: Point | null, scale: number) => {
      const running = gesture.current;
      if (running?.pointerId !== pointerId) return;
      // The release carries the hand's last position, and the frame coalescing
      // it may never have run; this settles the drag on its final rect.
      const settled =
        pointer === null
          ? running
          : (reduceFrameDrag(running, { type: 'move', pointerId, pointer, scale }).drag ?? running);
      gesture.current = null;
      setHeld(null);
      const { commit: rect } = reduceFrameDrag(settled, { type: 'release', pointerId });
      if (rect === null) return;
      commit([
        { designId: settled.designId, expectedLayoutVersion: settled.expectedLayoutVersion, rect },
      ]);
    },
    [commit],
  );

  const abandon = useCallback(() => {
    if (gesture.current === null) return;
    gesture.current = null;
    setHeld(null);
  }, []);

  useEffect(() => {
    setPending((current) => reducePendingRects(current, { type: 'acknowledged', frames }));
  }, [frames]);

  return {
    rectOf,
    heldDesignId: held?.designId ?? null,
    hold,
    move,
    release,
    abandon,
    place: commit,
    error,
  };
}

function layoutFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'That frame could not be moved.';
}
