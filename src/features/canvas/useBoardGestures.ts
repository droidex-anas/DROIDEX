// The board's hand: which of the three gestures is running, the pointer capture
// that keeps it, the one transform per animation frame it coalesces into, and
// the ways it ends — released, cancelled, or the capture lost out from under it.
//
// A frame under the hand snaps to the others (frameSnap.ts) unless ⌘ or Ctrl is
// held, and the gesture keeps the lines it snapped on for the board to draw. A
// release writes through useLayoutWrites, as a nudge, an align or a distribute does.

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
import { snapFrameRect, type SnapMarks } from './frameSnap';
import type { ArrangeFramesInput, CanvasFrame, FrameRect } from './protocol';
import { useLayoutWrites } from './useLayoutWrites';

/** Movement in board pixels before a frame press becomes a captured drag. */
const FRAME_DRAG_THRESHOLD_PX = 4;

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

/** Owns pointer capture and coalesced movement, and draws a held frame where the hand has it. */
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
  const [panning, setPanning] = useState(false);
  const writes = useLayoutWrites(frames, onArrangeFrames);
  const { supersede, dropHolds } = writes;
  const gesture = useRef<Gesture | null>(null);
  const move = useRef<{ pointer: Point | null; snapping: boolean; frame: number | null }>({
    pointer: null,
    snapping: true,
    frame: null,
  });
  const latest = useRef({ scale, onPan, onBand });
  latest.current = { scale, onPan, onBand };

  const stopCoalescing = useCallback(() => {
    if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
    move.current = { pointer: null, snapping: true, frame: null };
  }, []);

  /** Ends the gesture writing nothing. Answers whether there was one to end. */
  const cancelGesture = useCallback(() => {
    const active = gesture.current;
    if (active === null) return false;
    gesture.current = null;
    supersede();
    stopCoalescing();
    const root = board.current;
    if (root?.hasPointerCapture(active.pointerId)) root.releasePointerCapture(active.pointerId);
    setPanning(false);
    setDrag(null);
    setBand(null);
    if (active.kind === 'frame') {
      // A cancelled re-drag restores acknowledged geometry, not its old hold.
      dropHolds([active.drag.designId]);
    }
    return true;
  }, [board, dropHolds, stopCoalescing, supersede]);

  /**
   * Space is released in whichever app holds the keyboard, which sends the board
   * no keyup, so losing focus is the only honest end of that hold.
   */
  const loseFocus = useCallback(() => {
    setSpaceHeld(false);
    cancelGesture();
  }, [cancelGesture]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGesture();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', loseFocus);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', loseFocus);
      cancelGesture();
    };
  }, [cancelGesture, loseFocus]);

  const rectFor = (frame: CanvasFrame): FrameRect =>
    drag?.designId === frame.designId ? drag.rect : writes.rectFor(frame);

  const applyPointer = useCallback((pointer: Point, snapping: boolean) => {
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
    const { scale } = latest.current;
    const stepped = reduceFrameDrag(active.drag, {
      type: 'move',
      pointerId: active.drag.pointerId,
      pointer,
      scale,
    }).drag;
    if (stepped === null) return;
    const { rect, ...marks } = snapping
      ? snapFrameRect(stepped.rect, stepped.handle, active.others, scale)
      : { rect: stepped.rect, ...NO_MARKS };
    active.drag = { ...stepped, rect };
    setDrag({ designId: stepped.designId, rect, marks });
  }, []);

  useEffect(() => {
    // Holding or letting go of ⌘ or Ctrl mid-drag re-places the frame at once,
    // without waiting for the pointer to move.
    const onModifier = (event: KeyboardEvent) => {
      if (event.key !== 'Meta' && event.key !== 'Control') return;
      move.current.snapping = snapsWith(event);
      const { pointer } = move.current;
      if (gesture.current?.kind === 'frame' && pointer !== null)
        applyPointer(pointer, move.current.snapping);
    };
    window.addEventListener('keydown', onModifier);
    window.addEventListener('keyup', onModifier);
    return () => {
      window.removeEventListener('keydown', onModifier);
      window.removeEventListener('keyup', onModifier);
    };
  }, [applyPointer]);

  const takePointer = () => {
    const root = board.current;
    if (!root) return null;
    root.focus({ preventScroll: true });
    supersede();
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
      others: frames
        .filter((other) => other.designId !== frame.designId)
        .map((other) => rectFor(other)),
    };
    setDrag({ designId: frame.designId, rect, marks: NO_MARKS });
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
      move.current.snapping = snapsWith(event);
      // Spec §11: the transform updates once per animation frame, and the pointer
      // is followed 1:1 with no easing behind the hand.
      move.current.frame ??= requestAnimationFrame(() => {
        move.current.frame = null;
        if (move.current.pointer !== null)
          applyPointer(move.current.pointer, move.current.snapping);
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
      applyPointer(
        boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY }),
        snapsWith(event),
      );
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
    writes.commit([
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
   * One layout write for frames the user has already finished placing: those
   * `designIds` names, at the rects `nextRects` gives for where they are drawn.
   * Frames it did not actually move are left out, so an align that moves one
   * frame writes one frame.
   */
  const place = (designIds: readonly string[], nextRects: (rects: FrameRect[]) => FrameRect[]) => {
    const placed = frames.filter((frame) => designIds.includes(frame.designId));
    const rects = nextRects(placed.map((frame) => rectFor(frame)));
    writes.commit(
      placed.flatMap((frame, index) => {
        const rect = rects[index];
        if (sameRect(rect, rectFor(frame))) return [];
        return [{ designId: frame.designId, expectedLayoutVersion: frame.layoutVersion, rect }];
      }),
    );
  };

  return {
    cursor: boardCursor(panning, band !== null, spaceHeld),
    band,
    spaceHeld,
    holdSpace: setSpaceHeld,
    layoutError: writes.error,
    rectFor,
    heldDesignId: drag?.designId ?? null,
    snapMarks: drag?.marks ?? null,
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
  marks: SnapMarks;
}

const NO_MARKS: SnapMarks = { guides: [], gaps: [] };

/** ⌘ or Ctrl held suspends snapping, so a frame can sit a pixel off its neighbours. */
function snapsWith(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return !event.metaKey && !event.ctrlKey;
}

/** The rubber band the hand is drawing, in board-local pixels. */
export interface Band {
  origin: Point;
  current: Point;
}

type Gesture =
  | { kind: 'pan'; pointerId: number; last: Point }
  | { kind: 'band'; pointerId: number; origin: Point; current: Point }
  | { kind: 'frame'; pointerId: number; drag: FrameDrag; others: FrameRect[] };

function boardCursor(panning: boolean, banding: boolean, spaceHeld: boolean): string {
  if (panning) return 'grabbing';
  if (banding) return 'crosshair';
  return spaceHeld ? 'grab' : 'default';
}
