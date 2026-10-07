// The board's pointer gesture machine: which of the three gestures the hand is
// running, the pointer capture that keeps it, the one transform per animation
// frame it coalesces into, and the ways it ends — released, cancelled, or the
// capture lost out from under it.
//
// It knows about pointers and nothing else. The viewport it moves belongs to
// `useBoardViewport`, the frame it drags to `useFrameLayout`, and which frames a
// finished rubber band covers is the board's to resolve, because only the board
// holds their rects.

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { FrameHandle, Point } from './canvasGeometry';
import type { BoardMode } from './canvasState';
import type { FrameLayout } from './useFrameLayout';
import type { BoardViewport } from './useBoardViewport';
import type { CanvasFrame } from './protocol';

export interface BoardGestures {
  /** The rubber band the hand is drawing, if it is drawing one. */
  band: { origin: Point; current: Point } | null;
  /** The cursor for whatever the hand is doing, or about to do. */
  cursor: string;
  /** Space held: a drag anywhere pans, including one that starts on a frame. */
  holdSpace: (held: boolean) => void;
  /** A pointerdown on the board background, which pans or draws a band. */
  startBackground: (event: PointerEvent<HTMLElement>) => void;
  /** A pointerdown on a frame's header or one of its resize handles. */
  startFrame: (frame: CanvasFrame, handle: FrameHandle, event: PointerEvent<HTMLElement>) => void;
  track: (event: PointerEvent<HTMLElement>) => void;
  end: (event: PointerEvent<HTMLElement>, released: boolean) => void;
  /**
   * Ends the gesture writing nothing, which is what Escape does to it. Answers
   * true when there was one to end, so Escape knows it has been spent.
   */
  cancel: () => boolean;
}

export function useBoardGestures({
  board,
  view,
  layout,
  mode,
  onClear,
  onBand,
}: {
  board: RefObject<HTMLElement | null>;
  view: BoardViewport;
  layout: FrameLayout;
  mode: BoardMode;
  /** A pan begins by clearing the selection, as clicking the background does. */
  onClear: () => void;
  /** The two screen points a finished band was drawn between. */
  onBand: (origin: Point, current: Point, additive: boolean) => void;
}): BoardGestures {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const running = useRef<Gesture | null>(null);
  const move = useRef<Coalesced>({ pointer: null, frame: null });

  // What the handlers that run from an animation frame read, since they cannot
  // close over the render that scheduled them.
  const latest = useRef({ view, layout });
  latest.current = { view, layout };

  const stopCoalescing = useCallback(() => {
    if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
    move.current = { pointer: null, frame: null };
  }, []);

  useEffect(
    () => () => {
      if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
    },
    [],
  );

  const start = (next: Gesture, pointerId: number) => {
    const root = board.current;
    if (!root) return;
    root.setPointerCapture(pointerId);
    running.current = next;
    setGesture(next);
    view.stopAnimating();
  };

  /** Applies a pointer position to whichever gesture is running. */
  const applyPointer = (pointer: Point) => {
    const active = running.current;
    if (active === null) return;
    if (active.kind === 'pan') {
      latest.current.view.panByScreen({
        x: pointer.x - active.last.x,
        y: pointer.y - active.last.y,
      });
      active.last = pointer;
      return;
    }
    if (active.kind === 'band') {
      const extended: Gesture = { ...active, current: pointer };
      running.current = extended;
      setGesture(extended);
      return;
    }
    latest.current.layout.move(active.pointerId, pointer, latest.current.view.viewport.scale);
  };

  const flushMove = () => {
    move.current.frame = null;
    if (move.current.pointer !== null) applyPointer(move.current.pointer);
  };

  const startBackground = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || running.current !== null) return;
    const client = { x: event.clientX, y: event.clientY };
    // Spec §4: background drag and Space-drag pan. Shift-drag draws the rubber
    // band, which is the gesture left for one on a board whose empty space pans.
    if (event.shiftKey && mode === 'select') {
      const origin = boardPoint(board.current, client);
      start({ kind: 'band', pointerId: event.pointerId, origin, current: origin }, event.pointerId);
      return;
    }
    onClear();
    view.markNavigated();
    start({ kind: 'pan', pointerId: event.pointerId, last: client }, event.pointerId);
  };

  const startFrame = (
    frame: CanvasFrame,
    handle: FrameHandle,
    event: PointerEvent<HTMLElement>,
  ) => {
    if (running.current !== null) return;
    const client = { x: event.clientX, y: event.clientY };
    if (spaceHeld) {
      view.markNavigated();
      start({ kind: 'pan', pointerId: event.pointerId, last: client }, event.pointerId);
      return;
    }
    if (!layout.hold(frame, handle, event.pointerId, client)) return;
    start({ kind: 'frame', pointerId: event.pointerId }, event.pointerId);
  };

  const track = (event: PointerEvent<HTMLElement>) => {
    const active = running.current;
    if (active?.pointerId !== event.pointerId) return;
    const client = { x: event.clientX, y: event.clientY };
    move.current.pointer = active.kind === 'band' ? boardPoint(board.current, client) : client;
    // Spec §11: the transform updates once per animation frame, and the pointer
    // is followed 1:1 with no easing behind the hand.
    move.current.frame ??= requestAnimationFrame(flushMove);
  };

  const end = (event: PointerEvent<HTMLElement>, released: boolean) => {
    const active = running.current;
    if (active?.pointerId !== event.pointerId) return;
    stopCoalescing();
    running.current = null;
    setGesture(null);
    const client = { x: event.clientX, y: event.clientY };
    if (active.kind === 'pan') {
      // The release carries the hand's last position, and the frame coalescing
      // it may never have run.
      if (released) view.panByScreen({ x: client.x - active.last.x, y: client.y - active.last.y });
      return;
    }
    if (active.kind === 'band') {
      if (released) onBand(active.origin, boardPoint(board.current, client), event.shiftKey);
      return;
    }
    if (released) layout.release(event.pointerId, client, view.viewport.scale);
    else layout.abandon();
  };

  const cancel = useCallback(() => {
    const active = running.current;
    if (active === null) return false;
    running.current = null;
    setGesture(null);
    stopCoalescing();
    board.current?.releasePointerCapture(active.pointerId);
    latest.current.layout.abandon();
    return true;
  }, [board, stopCoalescing]);

  // Escape has to reach a frame gesture whatever has focus, so it is listened
  // for on the window only while one is running.
  const holdingFrame = gesture?.kind === 'frame';
  useEffect(() => {
    if (!holdingFrame) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancel, holdingFrame]);

  return {
    band: gesture?.kind === 'band' ? { origin: gesture.origin, current: gesture.current } : null,
    cursor: boardCursor(gesture, spaceHeld),
    holdSpace: setSpaceHeld,
    startBackground,
    startFrame,
    track,
    end,
    cancel,
  };
}

type Gesture =
  | { kind: 'pan'; pointerId: number; last: Point }
  | { kind: 'frame'; pointerId: number }
  /** A rubber band, in the board element's own box. */
  | { kind: 'band'; pointerId: number; origin: Point; current: Point };

/** The hand's latest position and the frame that will apply it. */
interface Coalesced {
  pointer: Point | null;
  frame: number | null;
}

/** A client point in the board element's own box, where screen points live. */
function boardPoint(root: HTMLElement | null, client: Point): Point {
  if (!root) return client;
  const box = root.getBoundingClientRect();
  return { x: client.x - box.left, y: client.y - box.top };
}

function boardCursor(gesture: Gesture | null, spaceHeld: boolean): string {
  if (gesture?.kind === 'pan') return 'grabbing';
  if (gesture?.kind === 'band') return 'crosshair';
  return spaceHeld ? 'grab' : 'default';
}
