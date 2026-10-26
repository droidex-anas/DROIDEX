// The board's annotation editing: which tool is armed and in what colour, the
// mark selected or being typed into, the one gesture drawing or reshaping a
// mark, and the annotate each finished edit writes. A write is optimistic until
// the change feed answers it (annotationWrites.ts); a refused one is dropped,
// never retried, because the board keeps no local undo stack.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AnnotationColor, AnnotationDraft, AnnotateCanvasInput } from './annotationProtocol';
import {
  draggedDraft,
  extendStroke,
  movedDraft,
  resizedDraft,
  type AnnotationHandle,
  type AnnotationTool,
  type TextDraft,
} from './annotationGeometry';
import {
  AnnotationWriteQueue,
  nextExpectedVersion,
  shownMarks,
  unansweredWrites,
  withoutRefused,
  type ShownMark,
} from './annotationWrites';
import { boardPoint } from './boardCoordinates';
import {
  arrowDirection,
  nudgeStep,
  screenToCanvas,
  type Point,
  type Viewport,
} from './canvasGeometry';
import type { BoardInteraction, BoardInteractionEvent } from './canvasState';
import type { CanvasSnapshot } from './protocol';
import { annotationShortcut } from './boardKeys';
import { CanvasRequestError } from './client';

/** Screen pixels a press travels before it draws or moves anything. */
const DRAG_THRESHOLD_PX = 4;

/** What a press on a mark took hold of: the whole mark or one of its handles. */
export type MarkGrip = AnnotationHandle | 'move';

interface AnnotationInputs {
  board: RefObject<HTMLDivElement | null>;
  snapshot: Pick<CanvasSnapshot, 'annotations' | 'annotationsVersion'>;
  viewport: Viewport;
  /**
   * The frames' mode and selection. A mark and frames are never selected
   * together, and arming a tool leaves Interact, since marks are drawn in Select.
   */
  interaction: BoardInteraction;
  dispatch: (event: BoardInteractionEvent) => void;
  onAnnotate: (input: AnnotateCanvasInput) => Promise<unknown>;
}

type Gesture =
  | {
      kind: 'create';
      tool: AnnotationTool;
      pointerId: number;
      origin: Point;
      originScreen: Point;
      moved: boolean;
      points: Point[];
    }
  | {
      kind: 'edit';
      grip: MarkGrip;
      pointerId: number;
      start: AnnotationDraft;
      origin: Point;
      originScreen: Point;
      moved: boolean;
    };

/** Owns the annotation tools, selection, inline editing, gestures and writes. */
export function useAnnotationEditor({
  board,
  snapshot: { annotations, annotationsVersion },
  viewport,
  interaction,
  dispatch,
  onAnnotate,
}: AnnotationInputs) {
  const { mode } = interaction;
  const selectedFrameCount = interaction.selectedFrameIds.length;
  const [tool, setTool] = useState<AnnotationTool | null>(null);
  const [color, setColor] = useState<AnnotationColor>('red');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ draft: TextDraft; isNew: boolean } | null>(null);
  const [live, setLive] = useState<AnnotationDraft | null>(null);
  const [pending, setPending] = useState<AnnotateCanvasInput[]>([]);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState({ mode, selectedFrameCount });
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const writes = useRef<AnnotationWriteQueue | null>(null);

  // Interact and a picked frame take the board's attention from the marks.
  if (seen.mode !== mode || seen.selectedFrameCount !== selectedFrameCount) {
    setSeen({ mode, selectedFrameCount });
    if (mode === 'interact') setTool(null);
    if (mode === 'interact' || selectedFrameCount > 0) setSelectedId(null);
  }

  const unanswered = unansweredWrites(pending, annotationsVersion);
  const settled = shownMarks(annotations, unanswered);
  const marks = withEdits(settled, editing?.draft ?? live);
  const selected = marks.find((mark) => mark.draft.id === selectedId) ?? null;

  const latest = useRef({
    viewport,
    marks,
    annotationsVersion,
    unanswered,
    tool,
    color,
    onAnnotate,
  });
  latest.current = { viewport, marks, annotationsVersion, unanswered, tool, color, onAnnotate };

  useEffect(() => {
    setPending((held) => {
      const kept = unansweredWrites(held, annotationsVersion);
      return kept.length === held.length ? held : kept;
    });
  }, [annotationsVersion]);

  // One queue for the board's life, whatever identity onAnnotate has: closing it
  // drops the writes still waiting. A board shows one canvas for its whole life,
  // so the latest onAnnotate always targets the canvas the queue chains on.
  useEffect(() => {
    const queue = new AnnotationWriteQueue(
      (input) => latest.current.onAnnotate(input),
      (refused, failure) => {
        setPending((held) => withoutRefused(held, refused.mutationId));
        setError(annotateFailure(failure));
      },
    );
    writes.current = queue;
    return () => {
      queue.close();
    };
  }, []);

  const write = useCallback((upserts: AnnotationDraft[], deletes: string[]) => {
    const { annotationsVersion: version, unanswered: chained } = latest.current;
    const input: AnnotateCanvasInput = {
      mutationId: crypto.randomUUID(),
      expectedAnnotationsVersion: nextExpectedVersion(version, chained),
      upserts,
      deletes,
    };
    setPending((held) => [...held, input]);
    setError('');
    writes.current?.push(input);
  }, []);

  const toBoard = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const root = board.current;
      const screen = root ? boardPoint(root, { x: event.clientX, y: event.clientY }) : null;
      return screen && { screen, at: screenToCanvas(latest.current.viewport, screen) };
    },
    [board],
  );

  const cancelGesture = useCallback(() => {
    if (gesture.current === null) return false;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setLive(null);
    return true;
  }, []);

  /** The mark the gesture is drawing or reshaping, at the pointer's last place. */
  const drafted = useCallback((active: Gesture, to: Point): AnnotationDraft | null => {
    if (active.kind === 'edit') {
      const delta = { x: to.x - active.origin.x, y: to.y - active.origin.y };
      return active.grip === 'move'
        ? movedDraft(active.start, delta)
        : resizedDraft(active.start, active.grip, delta);
    }
    const { scale } = latest.current.viewport;
    if (active.tool === 'draw')
      return active.points.length < 2
        ? null
        : { id: 'drawing', color: latest.current.color, kind: 'path', points: active.points };
    const mark = { id: 'drawing', color: latest.current.color };
    return draggedDraft(active.tool, mark, active.origin, to, scale);
  }, []);

  useEffect(() => {
    let last: Point | null = null;
    const onMove = (event: PointerEvent) => {
      const active = gesture.current;
      const point = active?.pointerId === event.pointerId ? toBoard(event) : null;
      if (!active || !point) return;
      const { screen, at } = point;
      if (!active.moved) {
        const travel = Math.hypot(
          screen.x - active.originScreen.x,
          screen.y - active.originScreen.y,
        );
        if (travel < DRAG_THRESHOLD_PX) return;
        active.moved = true;
      }
      if (active.kind === 'create' && active.tool === 'draw')
        active.points = extendStroke(active.points, at);
      last = at;
      // The preview follows once per animation frame, as frame drags do.
      frame.current ??= requestAnimationFrame(() => {
        frame.current = null;
        if (gesture.current === active && last) setLive(drafted(active, last));
      });
    };
    const finish = (active: Gesture, to: Point) => {
      if (active.kind === 'edit') {
        const moved = active.moved ? drafted(active, to) : null;
        if (moved) write([moved], []);
        return;
      }
      const id = crypto.randomUUID();
      const { color: drawn, viewport: view } = latest.current;
      if (active.tool === 'draw') {
        const points = active.moved ? extendStroke(active.points, to) : active.points;
        if (points.length >= 2) write([{ id, color: drawn, kind: 'path', points }], []);
        return;
      }
      const end = active.moved ? to : null;
      const draft = draggedDraft(active.tool, { id, color: drawn }, active.origin, end, view.scale);
      if (!draft) return;
      // A finished shape hands the board back to Select with it selected.
      setTool(null);
      setSelectedId(id);
      if (draft.kind === 'text' || draft.kind === 'note') setEditing({ draft, isNew: true });
      else write([draft], []);
    };
    const onUp = (event: PointerEvent) => {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      const point = toBoard(event);
      cancelGesture();
      if (event.type === 'pointercancel' || !point) return;
      finish(active, point.at);
    };
    const onBlur = () => {
      cancelGesture();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
      cancelGesture();
    };
  }, [cancelGesture, drafted, toBoard, write]);

  const takePointer = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    board.current?.focus({ preventScroll: true });
    setError('');
  };

  /** A press on the drawing surface while a tool is armed. */
  const onSurfacePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const point = toBoard(event);
    if (event.button !== 0 || gesture.current !== null || !tool || !point) return;
    takePointer(event);
    setSelectedId(null);
    gesture.current = {
      kind: 'create',
      tool,
      pointerId: event.pointerId,
      origin: point.at,
      originScreen: point.screen,
      moved: false,
      points: [point.at],
    };
  };

  /** A press on a mark or one of its handles: selects it and may move or reshape it. */
  const onMarkPointerDown = (id: string, grip: MarkGrip, event: React.PointerEvent) => {
    const point = toBoard(event);
    const mark = marks.find((candidate) => candidate.draft.id === id);
    if (event.button !== 0 || gesture.current !== null || !mark || !point) return;
    takePointer(event);
    if (selectedId !== id) {
      setSelectedId(id);
      dispatch({ type: 'clear' });
    }
    gesture.current = {
      kind: 'edit',
      grip,
      pointerId: event.pointerId,
      start: mark.draft,
      origin: point.at,
      originScreen: point.screen,
      moved: false,
    };
  };

  const editText = (id: string) => {
    const mark = marks.find((candidate) => candidate.draft.id === id);
    if (mark?.draft.kind !== 'text' && mark?.draft.kind !== 'note') return;
    cancelGesture();
    setSelectedId(id);
    setEditing({ draft: mark.draft, isNew: false });
  };

  /** Saves typed text; clearing a mark's text removes the mark. */
  const commitText = (text: string) => {
    if (!editing) return;
    setEditing(null);
    board.current?.focus({ preventScroll: true });
    if (text.trim() !== '') {
      write([{ ...editing.draft, text }], []);
      return;
    }
    setSelectedId(null);
    if (!editing.isNew) write([], [editing.draft.id]);
  };

  const cancelText = () => {
    if (editing?.isNew) setSelectedId(null);
    setEditing(null);
    board.current?.focus({ preventScroll: true });
  };

  const pickTool = (next: AnnotationTool | null) => {
    cancelGesture();
    setTool(next);
    if (next === null) return;
    setSelectedId(null);
    if (mode === 'interact') dispatch({ type: 'escape' });
  };

  const pickColor = (next: AnnotationColor) => {
    setColor(next);
    if (selected && selected.draft.color !== next) write([{ ...selected.draft, color: next }], []);
  };

  /** Escape: the gesture first, then the armed tool, then the selected mark. */
  const escape = (): boolean => {
    if (cancelGesture()) return true;
    if (tool !== null) {
      setTool(null);
      return true;
    }
    if (selectedId === null) return false;
    setSelectedId(null);
    return true;
  };

  /**
   * A tool's letter wherever the board's shortcuts reach; on the board itself,
   * Delete removes the selected mark and the arrows nudge it as they do frames.
   */
  const runKey = (event: React.KeyboardEvent): boolean => {
    const shortcut = annotationShortcut(event);
    if (shortcut) {
      pickTool(shortcut);
      return true;
    }
    if (!selected || event.target !== board.current) return false;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      setSelectedId(null);
      write([], [selected.draft.id]);
      return true;
    }
    const direction = arrowDirection(event.key);
    if (!direction) return false;
    write([movedDraft(selected.draft, nudgeStep(direction, event.shiftKey))], []);
    return true;
  };

  return {
    tool,
    error,
    pickTool,
    /** A press on the board's background lets go of the mark and the frames. */
    clearSelection: () => {
      setSelectedId(null);
      dispatch({ type: 'clear' });
    },
    escape,
    runKey,
    onSurfacePointerDown,
    /** What the layer draws and the presses it hands back. */
    layer: {
      marks,
      selectedId: selected ? selectedId : null,
      editingId: editing?.draft.id ?? null,
      onMarkPointerDown,
      onEditText: editText,
      onCommitText: commitText,
      onCancelText: cancelText,
    },
    /** The rail's annotation group. */
    rail: {
      tool,
      color: selected?.draft.color ?? color,
      showColors: tool !== null || selected !== null,
      onTool: pickTool,
      onColor: pickColor,
    },
  };
}

/** The settled marks with the one being drawn, moved or typed into put in its place. */
function withEdits(marks: ShownMark[], edit: AnnotationDraft | null): ShownMark[] {
  if (edit === null) return marks;
  const at = marks.findIndex((mark) => mark.draft.id === edit.id);
  if (at < 0) return [...marks, { draft: edit, author: { kind: 'user' } }];
  return marks.map((mark, index) => (index === at ? { ...mark, draft: edit } : mark));
}

function annotateFailure(error: unknown): string {
  if (error instanceof CanvasRequestError && error.code === 'revision_conflict')
    return 'The annotations changed elsewhere, so that edit was dropped.';
  return error instanceof Error && error.message
    ? error.message
    : 'That annotation could not be saved.';
}
