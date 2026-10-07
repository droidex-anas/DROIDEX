import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { boardPoint } from './boardCoordinates';
import { reduceFrameDrag, type FrameDrag, type Point } from './canvasGeometry';
import type { ArrangeFramesInput, CanvasFrame, FrameRect } from './protocol';

interface GestureInputs {
  board: RefObject<HTMLDivElement | null>;
  frames: CanvasFrame[];
  scale: number;
  spaceHeld: boolean;
  onStart: () => void;
  onPan: (delta: Point) => void;
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>;
}

/** Owns pointer capture, coalesced movement and transient frame layout. */
export function useBoardGestures({
  board,
  frames,
  scale,
  spaceHeld,
  onStart,
  onPan,
  onArrangeFrames,
}: GestureInputs) {
  const [drag, setDrag] = useState<DraggedFrame | null>(null);
  const [pending, setPending] = useState<Map<string, PendingLayout>>(() => new Map());
  const [panning, setPanning] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const gesture = useRef<Gesture | null>(null);
  const move = useRef<{ pointer: Point | null; frame: number | null }>({
    pointer: null,
    frame: null,
  });
  const latest = useRef({ scale, onPan, frames });
  latest.current = { scale, onPan, frames };
  const work = useRef(0);
  const mounted = useRef(false);

  const stopCoalescing = useCallback(() => {
    if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
    move.current = { pointer: null, frame: null };
  }, []);

  const cancelGesture = useCallback(() => {
    const active = gesture.current;
    if (active === null) return;
    gesture.current = null;
    work.current += 1;
    stopCoalescing();
    const root = board.current;
    const pointerId = pointerIdOf(active);
    if (root?.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    setPanning(false);
    setDrag(null);
    if (active.kind === 'frame') {
      // A cancelled re-drag restores acknowledged geometry, not its old hold.
      setPending((held) => withoutHold(held, active.drag.designId));
    }
  }, [board, stopCoalescing]);

  useEffect(() => {
    mounted.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGesture();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancelGesture);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', cancelGesture);
      cancelGesture();
    };
  }, [cancelGesture]);

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

  const applyPointer = (pointer: Point) => {
    const active = gesture.current;
    if (active === null) return;
    if (active.kind === 'pan') {
      latest.current.onPan({ x: pointer.x - active.last.x, y: pointer.y - active.last.y });
      active.last = pointer;
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

  const startPan = (pointerId: number, pointer: Point) => {
    const root = board.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    root.setPointerCapture(pointerId);
    work.current += 1;
    setLayoutError('');
    gesture.current = { kind: 'pan', pointerId, last: pointer };
    onStart();
    setPanning(true);
  };

  const onBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current !== null) return;
    startPan(
      event.pointerId,
      boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY }),
    );
  };

  const onFramePointerDown = (frame: CanvasFrame, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || gesture.current !== null) return;
    event.stopPropagation();
    const root = board.current;
    if (!root) return;
    const pointer = boardPoint(root, { x: event.clientX, y: event.clientY });
    if (spaceHeld) {
      startPan(event.pointerId, pointer);
      return;
    }
    root.focus({ preventScroll: true });
    root.setPointerCapture(event.pointerId);
    work.current += 1;
    setLayoutError('');
    onStart();
    const rect = rectFor(frame);
    gesture.current = {
      kind: 'frame',
      drag: {
        designId: frame.designId,
        pointerId: event.pointerId,
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
    if (active === null || event.pointerId !== pointerIdOf(active)) return;
    move.current.pointer = boardPoint(event.currentTarget, { x: event.clientX, y: event.clientY });
    move.current.frame ??= requestAnimationFrame(() => {
      move.current.frame = null;
      if (move.current.pointer !== null) applyPointer(move.current.pointer);
    });
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, released: boolean) => {
    const active = gesture.current;
    if (active === null || event.pointerId !== pointerIdOf(active)) return;
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
    if (active.kind === 'pan') return;
    const { commit } = reduceFrameDrag(active.drag, {
      type: 'release',
      pointerId: active.drag.pointerId,
    });
    if (commit === null) return;
    const { designId, expectedLayoutVersion } = active.drag;
    const mutationId = crypto.randomUUID();
    const operation = work.current;
    setPending((held) =>
      new Map(held).set(designId, {
        mutationId,
        rect: commit,
        afterLayoutVersion: expectedLayoutVersion,
      }),
    );
    setLayoutError('');
    onArrangeFrames({
      mutationId,
      frames: [{ designId, expectedLayoutVersion, rect: commit }],
    }).catch((error: unknown) => {
      if (!mounted.current) return;
      const frame = latest.current.frames.find((candidate) => candidate.designId === designId);
      if (!frame || frame.layoutVersion > expectedLayoutVersion) return;
      setPending((held) => {
        if (held.get(designId)?.mutationId !== mutationId) return held;
        return withoutHold(held, designId);
      });
      if (work.current === operation) {
        setLayoutError(
          error instanceof Error && error.message
            ? error.message
            : 'That frame could not be moved.',
        );
      }
    });
  };

  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return;
    cancelGesture();
  };

  return {
    panning,
    layoutError,
    rectFor,
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

interface PendingLayout {
  mutationId: string;
  rect: FrameRect;
  afterLayoutVersion: number;
}

function withoutHold(
  held: Map<string, PendingLayout>,
  designId: string,
): Map<string, PendingLayout> {
  if (!held.has(designId)) return held;
  const remaining = new Map(held);
  remaining.delete(designId);
  return remaining;
}

type Gesture = { kind: 'pan'; pointerId: number; last: Point } | { kind: 'frame'; drag: FrameDrag };

function pointerIdOf(gesture: Gesture): number {
  return gesture.kind === 'pan' ? gesture.pointerId : gesture.drag.pointerId;
}
