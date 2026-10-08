// The board: one transformed world layer holding the frames, the keyboard
// commands over it, and the control strip along its bottom edge.
//
// The board owns preview-slot retention and when the Select overlay can flip:
// the hit-test change waits for an active wheel gesture to finish.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { BoardControls } from './BoardControls';
import {
  alignRects,
  arrowDirection,
  distributeRects,
  framesInBand,
  nudgeStep,
  visibleDesignIds,
  type AlignEdge,
  type DistributeAxis,
  type PlacedFrame,
  type Point,
  type Viewport,
} from './canvasGeometry';
import {
  reduceBoardInteraction,
  type BoardInteraction,
  type BoardInteractionEvent,
  type BoardMode,
} from './canvasState';
import { DesignFrame } from './DesignFrame';
import { useCanvasMotion } from './useCanvasMotion';
import { NO_PREVIEW_SLOTS, reducePreviewSlots, type PreviewSlotRequest } from './previewSlots';
import { useBoardGestures, type Band } from './useBoardGestures';
import { useBoardViewport } from './useBoardViewport';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

/** Board-local pixels one arrow key pans by when nothing is selected. */
const ARROW_PAN_PX = 32;

export interface CanvasBoardHandle {
  /** Centers the acknowledged frame and gives keyboard focus to the board. */
  focusFrame: (frameId: string) => void;
}

export interface CanvasBoardProps {
  ref?: Ref<CanvasBoardHandle>;
  snapshot: CanvasSnapshot;
  /**
   * The one layout write the board makes, for a released gesture as much as for
   * a nudge, an align or a distribute. `CanvasWorkspace` binds it to
   * `CanvasClient.arrangeFrames` for this canvas.
   */
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>;
  /** One frame's live preview, mounted only while that frame holds a slot. */
  renderPreview: (frame: CanvasFrame) => ReactNode;
  /** Mode and selection, so the toolbar and navigator read the same values. */
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  onOpenSource?: (designId: string) => void;
}

export function CanvasBoard({
  ref,
  snapshot,
  onArrangeFrames,
  renderPreview,
  interaction,
  onInteractionChange,
  onOpenSource,
}: CanvasBoardProps) {
  const motion = useCanvasMotion();
  const board = useRef<HTMLDivElement>(null);
  const { frames } = snapshot;

  const view = useBoardViewport(board, frames, motion);
  const { fitTo } = view;
  const [retainedSlots, setRetainedSlots] = useState(NO_PREVIEW_SLOTS);
  const [overlayCapture, setOverlayCapture] = useState(interaction.mode === 'select');
  // What the callbacks the gesture machine holds read, since they cannot close
  // over the render that registered them. Filled in below, once the rects the
  // board actually draws are known.
  const latest = useRef<BoardReads>({ interaction, drawn: [], viewport: view.viewport });

  const dispatch = useCallback(
    (event: BoardInteractionEvent) => {
      const current = latest.current.interaction;
      const next = reduceBoardInteraction(current, event);
      if (next !== current) onInteractionChange(next);
    },
    [onInteractionChange],
  );

  const pickBand = useCallback(
    (origin: Point, current: Point, additive: boolean) => {
      const { drawn, viewport } = latest.current;
      dispatch({
        type: 'pick-band',
        designIds: framesInBand(drawn, viewport, origin, current),
        additive,
      });
    },
    [dispatch],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: 'clear' });
  }, [dispatch]);

  const gestures = useBoardGestures({
    board,
    frames,
    scale: view.viewport.scale,
    mode: interaction.mode,
    onStart: () => {
      view.markNavigated();
      view.stopAnimating();
    },
    onPan: view.panByScreen,
    onClear: clearSelection,
    onBand: pickBand,
    onArrangeFrames,
  });

  const { scale } = view.viewport;
  // Where every frame is drawn, which is what the queries below measure and
  // what a finished placement starts from.
  const drawn: PlacedFrame[] = frames.map((frame) => ({
    designId: frame.designId,
    rect: gestures.rectFor(frame),
  }));
  latest.current = { interaction, drawn, viewport: view.viewport };

  // Selection and Interact must never point at a design the canvas has lost.
  const designIds = useMemo(() => frames.map((frame) => frame.designId), [frames]);
  useEffect(() => {
    dispatch({ type: 'frames', designIds });
  }, [designIds, dispatch]);

  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  useImperativeHandle(ref, (): CanvasBoardHandle => ({ focusFrame: setFocusRequest }), []);

  // A focus asked for before its frame arrived waits for it rather than being
  // dropped: Open on an artifact card reaches the pane before the snapshot does.
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
  }, [dispatch, fitTo, focusRequest, frames]);

  const visible = visibleDesignIds(drawn, view.viewport, view.size);
  const slotRequest: PreviewSlotRequest = {
    designIds: frames
      .filter((frame) => frame.build.status === 'ready' || frame.build.status === 'failed')
      .map((frame) => frame.designId),
    visible,
    interacted: interaction.interactedFrameId,
    selected: interaction.selectedFrameIds,
  };
  const slots = reducePreviewSlots(retainedSlots, slotRequest);
  if (slots !== retainedSlots) setRetainedSlots(slots);

  // Spec §4: the overlay's hit-test flip waits for an arriving wheel gesture to
  // go quiet and then for the frame that paints it, so it is committed before
  // any later input is read against it.
  const capturePointer = interaction.mode === 'select';
  useEffect(() => {
    if (overlayCapture === capturePointer || view.scrolling) return undefined;
    const frame = requestAnimationFrame(() => {
      setOverlayCapture(capturePointer);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [capturePointer, overlayCapture, view.scrolling]);

  /**
   * One layout write for the selection, computed from the rects it is drawn at.
   */
  const placeSelection = (nextRects: (rects: FrameRect[]) => FrameRect[]) => {
    const selected = frames.filter((frame) =>
      interaction.selectedFrameIds.includes(frame.designId),
    );
    const placed = nextRects(selected.map((frame) => gestures.rectFor(frame)));
    gestures.place(
      selected.map((frame, index) => ({
        designId: frame.designId,
        expectedLayoutVersion: frame.layoutVersion,
        rect: placed[index],
      })),
    );
  };

  const onBoardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Inputs and editors keep their shortcuts, including Escape.
    if (isBoardEditor(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      // A gesture consumes the first Escape before mode or selection changes.
      if (!gestures.cancel()) dispatch({ type: 'escape' });
      return;
    }
    // Other board commands belong to the board and its frame headers.
    if (event.target !== event.currentTarget && !isFrameHeader(event.target)) return;
    if (event.key === ' ') {
      event.preventDefault();
      gestures.holdSpace(true);
      return;
    }
    if (event.key === 'Enter' && interaction.selectedFrameIds.length === 1) {
      event.preventDefault();
      dispatch({ type: 'interact', designId: interaction.selectedFrameIds[0] });
      return;
    }
    const direction = arrowDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    if (interaction.selectedFrameIds.length === 0) {
      view.markNavigated();
      view.stopAnimating();
      view.panByScreen({ x: -direction.x * ARROW_PAN_PX, y: -direction.y * ARROW_PAN_PX });
      return;
    }
    const step = nudgeStep(direction, event.shiftKey);
    placeSelection((rects) =>
      rects.map((rect) => ({ ...rect, x: rect.x + step.x, y: rect.y + step.y })),
    );
  };

  const onMode = (next: BoardMode) => {
    if (next === interaction.mode) return;
    if (next === 'select') {
      dispatch({ type: 'escape' });
      return;
    }
    const target = interaction.selectedFrameIds.at(0) ?? frames.at(0)?.designId;
    if (target !== undefined) dispatch({ type: 'interact', designId: target });
  };

  return (
    <div
      ref={board}
      data-testid="canvas-board"
      data-board-mode={interaction.mode}
      tabIndex={0}
      aria-label="Design board"
      className="relative h-full min-h-0 w-full overflow-hidden bg-droid-bg outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-droid-accent/10"
      style={{ cursor: gestures.cursor, touchAction: 'none' }}
      onPointerDown={gestures.onBackgroundPointerDown}
      onPointerUp={(event) => {
        gestures.endGesture(event, true);
      }}
      onPointerCancel={(event) => {
        gestures.endGesture(event, false);
      }}
      onLostPointerCapture={(event) => {
        gestures.endGesture(event, false);
      }}
      onKeyDown={onBoardKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') gestures.holdSpace(false);
      }}
      onBlur={gestures.onBlur}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${String(view.viewport.x)}px, ${String(view.viewport.y)}px) scale(${String(scale)})`,
          transformOrigin: '0 0',
        }}
      >
        {frames.map((frame, index) => (
          <DesignFrame
            key={frame.designId}
            frame={frame}
            rect={drawn[index].rect}
            scale={scale}
            motion={motion}
            visible={visible.includes(frame.designId)}
            mode={interaction.mode}
            selected={interaction.selectedFrameIds.includes(frame.designId)}
            interacted={interaction.interactedFrameId === frame.designId}
            held={gestures.heldDesignId === frame.designId}
            capturePointer={overlayCapture}
            preview={slots.live.includes(frame.designId) ? renderPreview(frame) : null}
            released={slots.released.includes(frame.designId)}
            onExitInteract={() => {
              dispatch({ type: 'escape' });
              board.current?.focus({ preventScroll: true });
            }}
            onOpenSource={onOpenSource}
            onHold={gestures.onFramePointerDown}
            onPick={(picked, additive) => {
              dispatch({ type: 'pick', designId: picked.designId, additive });
            }}
            onInteract={(picked) => {
              dispatch({ type: 'interact', designId: picked.designId });
            }}
          />
        ))}
      </div>

      {gestures.band && <RubberBand band={gestures.band} />}

      <BoardControls
        scale={scale}
        motion={motion}
        mode={interaction.mode}
        selectedCount={interaction.selectedFrameIds.length}
        hasFrames={frames.length > 0}
        error={gestures.layoutError}
        onMode={onMode}
        onFit={() => {
          fitTo(drawn.map(({ rect }) => rect));
        }}
        onAlign={(edge: AlignEdge) => {
          placeSelection((rects) => alignRects(rects, edge));
        }}
        onDistribute={(axis: DistributeAxis) => {
          placeSelection((rects) => distributeRects(rects, axis));
        }}
      />
    </div>
  );
}

/** The rubber band, drawn in screen space above the world layer. */
function RubberBand({ band: { origin, current } }: { band: Band }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-md bg-droid-accent/10 ring-1 ring-droid-accent/30"
      style={{
        left: Math.min(origin.x, current.x),
        top: Math.min(origin.y, current.y),
        width: Math.abs(current.x - origin.x),
        height: Math.abs(current.y - origin.y),
      }}
    />
  );
}

interface BoardReads {
  interaction: BoardInteraction;
  drawn: PlacedFrame[];
  viewport: Viewport;
}

function isFrameHeader(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.dataset.frameHeader !== undefined;
}

function isBoardEditor(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="textbox"]') !== null)
  );
}
