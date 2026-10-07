// The board's hand: which of the three gestures is running, the pointer capture
// that keeps it, the one transform per animation frame it coalesces into, and
// the ways it ends — released, cancelled, or the capture lost out from under it.
//
// It also owns every layout write and the transient rects drawn before one is
// acknowledged, because a release and a finished nudge, align or distribute are
// the same compare-and-set: one `arrangeFrames` carrying the layout version each
// frame was read at, so a frame a remote chat moved in the meantime is refused
// rather than overwritten. An arrange never touches source or revisions.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { boardPoint } from './boardCoordinates';
import {
  reduceFrameDrag,
  sameRect,
  type FrameDrag,
  type FrameHandle,
  type Point,
} from './canvasGeometry';
import type { BoardMode } from './canvasState';
import type { ArrangeFramesInput, CanvasFrame, FrameRect } from './protocol';

/** One frame's new rect and the layout version it was read at. */
export type FramePlacement = ArrangeFramesInput['frames'][number];

interface GestureInputs {
  board: RefObject<HTMLDivElement | null>;
  frames: CanvasFrame[];
  scale: number;
  mode: BoardMode;
  /** A hand gesture is about to take the viewport away from Fit and animation. */
  onStart: () => void;
  onPan: (delta: Point) => void;
  /** A background pan begins by clearing the selection, as a plain click does. */
  onClear: () => void;
  /** The two board-local points a finished rubber band was drawn between. */
  onBand: (origin: Point, current: Point, additive: boolean) => void;
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>;
}

/** Owns pointer capture, coalesced movement, and every layout write. */
export function useBoardGestures({
  board,
  frames,
  scale,
  mode,
  onStart,
  onPan,
  onClear,
  onBand,
  onArrangeFrames,
}: GestureInputs) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drag, setDrag] = useState<DraggedFrame | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [pending, setPending] = useState<Map<string, PendingLayout>>(() => new Map());
  const [panning, setPanning] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const gesture = useRef<Gesture | null>(null);
  const move = useRef<{ pointer: Point | null; frame: number | null }>({
    pointer: null,
    frame: null,
  });
  const latest = useRef({ scale, onPan, onBand, frames });
  latest.current = { scale, onPan, onBand, frames };
  const work = useRef(0);
  const mounted = useRef(false);

  const stopCoalescing = useCallback(() => {
    if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
    move.current = { pointer: null, frame: null };
  }, []);

  /** Ends the gesture writing nothing. Answers whether there was one to end. */
  const cancelGesture = useCallback(() => {
    const active = gesture.current;
    if (active === null) return false;
    gesture.current = null;
    work.current += 1;
    stopCoalescing();
    const root = board.current;
    if (root?.hasPointerCapture(active.pointerId)) root.releasePointerCapture(active.pointerId);
    setPanning(false);
    setDrag(null);
    setBand(null);
    if (active.kind === 'frame') {
      // A cancelled re-drag restores acknowledged geometry, not its old hold.
      setPending((held) => withoutHolds(held, [active.drag.designId]));
    }
    return true;
  }, [board, stopCoalescing]);

  /**
   * Space is released in whichever app holds the keyboard, which sends the board
   * no keyup, so losing focus is the only honest end of that hold.
   */
  const loseFocus = useCallback(() => {
    setSpaceHeld(false);
    cancelGesture();
  }, [cancelGesture]);

  useEffect(() => {
    mounted.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGesture();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', loseFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', loseFocus);
      cancelGesture();
    };
  }, [cancelGesture, loseFocus]);

  useEffect(() => {
    // Prune retired holds; applicability is derived below before this runs.
    setPending((held) => {
      const remaining = new Map(held);
      for (const [designId, hold] of held) {
        const frame = frames.find((candidate) => candidate.designId === designId);
        if (!frame || frame.layoutVersion > hold.afterLayoutVersion) remaining.delete(designId);
      }
      return remaining.size === held.size ? held : remaining;
    });
  }, [frames]);

  const rectFor = (frame: CanvasFrame): FrameRect => {
    if (drag?.designId === frame.designId) return drag.rect;
    const hold = pending.get(frame.designId);
    if (hold && frame.layoutVersion <= hold.afterLayoutVersion) return hold.rect;
    return frame.rect;
  };

  /**
   * The one layout write, shared by a released gesture and by a nudge, an align
   * or a distribute that is already finished when it arrives.
   */
  const commit = (placements: FramePlacement[]) => {
    if (placements.length === 0) return;
    const mutationId = crypto.randomUUID();
    work.current += 1;
    const operation = work.current;
    setPending((held) => {
      const next = new Map(held);
      for (const { designId, rect, expectedLayoutVersion } of placements)
        next.set(designId, { mutationId, rect, afterLayoutVersion: expectedLayoutVersion });
      return next;
    });
    setLayoutError('');
    onArrangeFrames({ mutationId, frames: placements }).catch((error: unknown) => {
      if (!mounted.current) return;
      // A refusal that arrives after the sidecar has already published newer
      // layout for every frame it named is nobody's answer: it can neither
      // restore a rect nor describe anything the user is still looking at.
      const current = placements.filter(({ designId, expectedLayoutVersion }) => {
        const frame = latest.current.frames.find((candidate) => candidate.designId === designId);
        return frame !== undefined && frame.layoutVersion <= expectedLayoutVersion;
      });
      if (current.length === 0) return;
      setPending((held) =>
        withoutHolds(
          held,
          current
            .filter(({ designId }) => held.get(designId)?.mutationId === mutationId)
            .map(({ designId }) => designId),
        ),
      );
      if (work.current === operation) setLayoutError(layoutFailure(error));
    });
  };

  const applyPointer = (pointer: Point) => {
    const active = gesture.current;
    if (active === null) return;
    if (active.kind === 'pan') {
      latest.current.onPan({ x: pointer.x - active.last.x, y: pointer.y - active.last.y });
      active.last = pointer;
      return;
    }
    if (active.kind === 'band') {
      active.current = pointer;
      setBand({ origin: active.origin, current: pointer });
      return;
    }
    const stepped = reduceFrameDrag(active.drag, {
      type: 'move',
      pointerId: active.drag.pointerId,
      pointer,
      scale: latest.current.scale,
    }).drag;
    if (stepped === null) return;
    active.drag = stepped;
    setDrag({ designId: stepped.designId, rect: stepped.rect });
  };

  const takePointer = (pointerId: number) => {
    const root = board.current;
    if (!root) return null;
    root.focus({ preventScroll: true });
    root.setPointerCapture(pointerId);
    work.current += 1;
    setLayoutError('');
    return root;
  };

  const startPan = (pointerId: number, pointer: Point) => {
    if (!takePointer(pointerId)) return;
    gesture.current = { kind: 'pan', pointerId, last: pointer };
    onStart();
    setPanning(true);
  };

  const onBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current !== null) return;
    const pointer = boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY });
    // Spec §4: background drag and Space-drag pan, so Shift-drag is the gesture
    // left for the rubber band on a board whose empty space pans.
    if (event.shiftKey && mode === 'select') {
      if (!takePointer(event.pointerId)) return;
      gesture.current = {
        kind: 'band',
        pointerId: event.pointerId,
        origin: pointer,
        current: pointer,
      };
      setBand({ origin: pointer, current: pointer });
      return;
    }
    onClear();
    startPan(event.pointerId, pointer);
  };

  const onFramePointerDown = (
    frame: CanvasFrame,
    handle: FrameHandle,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0 || gesture.current !== null) return;
    event.stopPropagation();
    const root = board.current;
    if (!root) return;
    const pointer = boardPoint(root, { x: event.clientX, y: event.clientY });
    if (spaceHeld) {
      startPan(event.pointerId, pointer);
      return;
    }
    if (!takePointer(event.pointerId)) return;
    onStart();
    // The gesture starts from where the user sees the frame, which is not the
    // snapshot's rect while an earlier commit is still unacknowledged.
    const rect = rectFor(frame);
    gesture.current = {
      kind: 'frame',
      pointerId: event.pointerId,
      drag: {
        designId: frame.designId,
        pointerId: event.pointerId,
        handle,
        expectedLayoutVersion: frame.layoutVersion,
        origin: pointer,
        startRect: rect,
        rect,
      },
    };
    setDrag({ designId: frame.designId, rect });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    move.current.pointer = boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY });
    // Spec §11: the transform updates once per animation frame, and the pointer
    // is followed 1:1 with no easing behind the hand.
    move.current.frame ??= requestAnimationFrame(() => {
      move.current.frame = null;
      if (move.current.pointer !== null) applyPointer(move.current.pointer);
    });
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, released: boolean) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    if (!released) {
      cancelGesture();
      return;
    }
    stopCoalescing();
    // Release may arrive before the queued frame applies the last movement.
    applyPointer(boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY }));
    gesture.current = null;
    const root = board.current;
    if (root?.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    setPanning(false);
    setDrag(null);
    setBand(null);
    if (active.kind === 'pan') return;
    if (active.kind === 'band') {
      latest.current.onBand(active.origin, active.current, event.shiftKey);
      return;
    }
    const { commit: rect } = reduceFrameDrag(active.drag, {
      type: 'release',
      pointerId: active.drag.pointerId,
    });
    if (rect === null) return;
    commit([
      {
        designId: active.drag.designId,
        expectedLayoutVersion: active.drag.expectedLayoutVersion,
        rect,
      },
    ]);
  };

  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return;
    loseFocus();
  };

  /**
   * One layout write for frames the user has already finished placing. Frames
   * the operation did not actually move are left out, so an align that moves
   * one frame writes one frame.
   */
  const place = (placements: FramePlacement[]) => {
    commit(
      placements.filter(({ designId, rect }) => {
        const frame = frames.find((candidate) => candidate.designId === designId);
        return frame !== undefined && !sameRect(rect, rectFor(frame));
      }),
    );
  };

  return {
    cursor: boardCursor(panning, band !== null, spaceHeld),
    band,
    spaceHeld,
    holdSpace: setSpaceHeld,
    layoutError,
    rectFor,
    heldDesignId: drag?.designId ?? null,
    place,
    cancel: cancelGesture,
    onBackgroundPointerDown,
    onFramePointerDown,
    onPointerMove,
    endGesture,
    onBlur,
  };
}

interface DraggedFrame {
  designId: string;
  rect: FrameRect;
}

/** The rubber band the hand is drawing, in board-local pixels. */
export interface Band {
  origin: Point;
  current: Point;
}

interface PendingLayout {
  mutationId: string;
  rect: FrameRect;
  afterLayoutVersion: number;
}

function withoutHolds(
  held: Map<string, PendingLayout>,
  designIds: string[],
): Map<string, PendingLayout> {
  const dropped = designIds.filter((designId) => held.has(designId));
  if (dropped.length === 0) return held;
  const remaining = new Map(held);
  for (const designId of dropped) remaining.delete(designId);
  return remaining;
}

type Gesture =
  | { kind: 'pan'; pointerId: number; last: Point }
  | { kind: 'band'; pointerId: number; origin: Point; current: Point }
  | { kind: 'frame'; pointerId: number; drag: FrameDrag };

function boardCursor(panning: boolean, banding: boolean, spaceHeld: boolean): string {
  if (panning) return 'grabbing';
  if (banding) return 'crosshair';
  return spaceHeld ? 'grab' : 'default';
}

function layoutFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'That frame could not be moved.';
}
