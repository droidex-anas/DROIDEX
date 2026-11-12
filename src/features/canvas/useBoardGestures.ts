// The board's hand: which of the three gestures is running, the pointer capture
// that keeps it, the one transform per animation frame it coalesces into, and
// the ways it ends — released, cancelled, or the capture lost out from under it.
//
// A frame under the hand carries the rest of the selection with it when it is
// part of one, and snaps to the other frames (frameSnap.ts) unless ⌘ or Ctrl is
// held; the gesture keeps the lines it snapped on for the board to draw. A
// release writes through useLayoutWrites, as a nudge, an align or a distribute does.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { boardPoint } from './boardCoordinates';
import {
  reduceFrameDrag,
  sameRect,
  type FrameDrag,
  type FrameHandle,
  type PlacedFrame,
  type Point,
} from './canvasGeometry';
import type { BoardMode } from './canvasState';
import { snapFrameRect, snapGroupMove, type SnapMarks } from './frameSnap';
import type { ArrangeFramesInput, CanvasFrame, FrameRect } from './protocol';
import { useLayoutWrites } from './useLayoutWrites';

/** Movement in board pixels before a frame press becomes a captured drag. */
const FRAME_DRAG_THRESHOLD_PX = 4;

interface GestureInputs {
  board: RefObject<HTMLDivElement | null>;
  frames: CanvasFrame[];
  scale: number;
  mode: BoardMode;
  /** The frames a move takes along when the hand lands on one of them. */
  selectedFrameIds: readonly string[];
  /** A hand gesture is about to take the viewport away from Fit and animation. */
  onStart: () => void;
  /** A hand gesture is over, released or cancelled, so the view it moved settles. */
  onEnd: () => void;
  onPan: (delta: Point) => void;
  /** A background pan begins by clearing the selection, as a plain click does. */
  onClear: () => void;
  /** The two board-local points a finished rubber band was drawn between. */
  onBand: (origin: Point, current: Point, additive: boolean) => void;
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>;
}

/** Owns pointer capture and coalesced movement, and draws held frames where the hand has them. */
export function useBoardGestures({
  board,
  frames,
  scale,
  mode,
  selectedFrameIds,
  onStart,
  onEnd,
  onPan,
  onClear,
  onBand,
  onArrangeFrames,
}: GestureInputs) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drag, setDrag] = useState<DraggedFrames | null>(null);
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
  const latest = useRef({ scale, onEnd, onPan, onBand });
  latest.current = { scale, onEnd, onPan, onBand };

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
    latest.current.onEnd();
    if (active.kind === 'frame') {
      // A cancelled re-drag restores acknowledged geometry, not its old hold.
      dropHolds(placedOf(active).map(({ designId }) => designId));
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
    drag?.placed.find(({ designId }) => designId === frame.designId)?.rect ?? writes.rectFor(frame);

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
    // With ⌘ or Ctrl held there is nothing to snap to.
    const targets = snapping ? active.others : [];
    if (stepped.handle !== 'move') {
      const { rect, ...marks } = snapFrameRect(stepped.rect, stepped.handle, targets, scale);
      active.drag = { ...stepped, rect };
      setDrag({ placed: placedOf(active), marks });
      return;
    }
    const { rects, ...marks } = snapGroupMove(
      [stepped.startRect, ...active.carried.map(({ startRect }) => startRect)],
      { x: stepped.rect.x - stepped.startRect.x, y: stepped.rect.y - stepped.startRect.y },
      targets,
      scale,
    );
    active.drag = { ...stepped, rect: rects[0] };
    active.carried = active.carried.map((carried, index) => ({
      ...carried,
      rect: rects[index + 1],
    }));
    setDrag({ placed: placedOf(active), marks });
  }, []);

  useEffect(() => {
    // Holding or letting go of ⌘ or Ctrl mid-drag re-places the frames at once,
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
    // The gesture starts from where the user sees each frame, which is not the
    // snapshot's rect while an earlier commit is still unacknowledged.
    const rect = rectFor(frame);
    const carried =
      handle === 'move' && selectedFrameIds.includes(frame.designId)
        ? frames.filter(
            (other) =>
              other.designId !== frame.designId && selectedFrameIds.includes(other.designId),
          )
        : [];
    const held: FrameGesture = {
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
      carried: carried.map((other) => {
        const start = rectFor(other);
        return {
          designId: other.designId,
          expectedLayoutVersion: other.layoutVersion,
          startRect: start,
          rect: start,
        };
      }),
      others: frames
        .filter((other) => other !== frame && !carried.includes(other))
        .map((other) => rectFor(other)),
    };
    gesture.current = held;
    setDrag({ placed: placedOf(held), marks: NO_MARKS });
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
    latest.current.onEnd();
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
      ...active.carried.map(({ designId, expectedLayoutVersion, rect: carriedRect }) => ({
        designId,
        expectedLayoutVersion,
        rect: carriedRect,
      })),
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
    heldDesignIds: drag?.placed.map(({ designId }) => designId) ?? [],
    snapMarks: drag?.marks ?? null,
    place,
    cancel: cancelGesture,
    onBackgroundPointerDown,
    onFramePointerDown,
    endGesture,
    onBlur,
  };
}

/** Where the held frames are drawn, and what they snapped on. */
interface DraggedFrames {
  placed: PlacedFrame[];
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
  | FrameGesture;

/**
 * The frame under the hand, the selected frames a move carries with it, and
 * every other frame, which is what they snap to.
 */
interface FrameGesture {
  kind: 'frame';
  pointerId: number;
  drag: FrameDrag;
  carried: CarriedFrame[];
  others: FrameRect[];
}

interface CarriedFrame {
  designId: string;
  expectedLayoutVersion: number;
  startRect: FrameRect;
  rect: FrameRect;
}

function placedOf({ drag, carried }: FrameGesture): PlacedFrame[] {
  return [
    { designId: drag.designId, rect: drag.rect },
    ...carried.map(({ designId, rect }) => ({ designId, rect })),
  ];
}

function boardCursor(panning: boolean, banding: boolean, spaceHeld: boolean): string {
  if (panning) return 'grabbing';
  if (banding) return 'crosshair';
  return spaceHeld ? 'grab' : 'default';
}
