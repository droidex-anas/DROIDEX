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

/** Movement in board pixels before a frame press becomes a captured drag. */
const FRAME_DRAG_THRESHOLD_PX = 4;

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
  const [refusal, setRefusal] = useState<LayoutRefusal | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const move = useRef<{ pointer: Point | null; frame: number | null }>({
    pointer: null,
    frame: null,
  });
  const latest = useRef({ scale, onPan, onBand });
  latest.current = { scale, onPan, onBand };
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
    setRefusal(null);
    onArrangeFrames({ mutationId, frames: placements }).catch((error: unknown) => {
      if (!mounted.current) return;
      // Dropping a hold is safe even when newer layout already answered it,
      // since `rectFor` ignores a hold once its frame moves past that version.
      setPending((held) =>
        withoutHolds(
          held,
          placements
            .filter(({ designId }) => held.get(designId)?.mutationId === mutationId)
            .map(({ designId }) => designId),
        ),
      );
      if (work.current === operation) setRefusal({ message: layoutFailure(error), placements });
    });
  };

  const applyPointer = useCallback((pointer: Point) => {
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
  }, []);

  const takePointer = () => {
    const root = board.current;
    if (!root) return null;
    root.focus({ preventScroll: true });
    work.current += 1;
    setRefusal(null);
    return root;
  };

  const startPan = (pointerId: number, pointer: Point) => {
    const root = takePointer();
    if (!root) return;
    root.setPointerCapture(pointerId);
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
      const root = takePointer();
      if (!root) return;
      root.setPointerCapture(event.pointerId);
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
    if (!takePointer()) return;
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

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      const root = board.current;
      if (!root) return;
      const pointer = boardPoint(root, { x: event.clientX, y: event.clientY });
      if (active.kind === 'frame' && !root.hasPointerCapture(event.pointerId)) {
        const { origin } = active.drag;
        if (Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < FRAME_DRAG_THRESHOLD_PX)
          return;
        // Leave clicks on their header/overlay; only a drag belongs to the root.
        root.setPointerCapture(event.pointerId);
      }
      move.current.pointer = pointer;
      // Spec §11: the transform updates once per animation frame, and the pointer
      // is followed 1:1 with no easing behind the hand.
      move.current.frame ??= requestAnimationFrame(() => {
        move.current.frame = null;
        if (move.current.pointer !== null) applyPointer(move.current.pointer);
      });
    },
    [applyPointer, board],
  );

  useEffect(() => {
    // Until capture starts, the press can leave the board. Keep that sequence
    // owned here so neither an outside movement nor release strands a gesture.
    const onPointerEnd = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) cancelGesture();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [cancelGesture, onPointerMove]);

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, released: boolean) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    if (!released) {
      cancelGesture();
      return;
    }
    stopCoalescing();
    const root = board.current;
    // Release may arrive before the queued frame applies the last movement.
    // An uncaptured frame press is a click, including any sub-threshold jitter.
    if (active.kind !== 'frame' || root?.hasPointerCapture(event.pointerId))
      applyPointer(boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY }));
    gesture.current = null;
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
    layoutError: refusal && isUnanswered(refusal, frames) ? refusal.message : '',
    rectFor,
    heldDesignId: drag?.designId ?? null,
    place,
    cancel: cancelGesture,
    onBackgroundPointerDown,
    onFramePointerDown,
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

/** A refused layout write and the placements it refused. */
interface LayoutRefusal {
  message: string;
  placements: FramePlacement[];
}

// Judged against the frames being drawn: one bridge batch can carry newer
// layout and the refusal it answers before React renders either.
function isUnanswered(refusal: LayoutRefusal, frames: CanvasFrame[]): boolean {
  return refusal.placements.some(({ designId, expectedLayoutVersion }) => {
    const frame = frames.find((candidate) => candidate.designId === designId);
    return frame !== undefined && frame.layoutVersion <= expectedLayoutVersion;
  });
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
