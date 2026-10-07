// The board: one transformed world layer holding the frames, the keyboard
// commands over it, and the control strip along its bottom edge.
//
// It owns no state of its own. The viewport belongs to `useBoardViewport`, the
// hand's gesture to `useBoardGestures`, every layout write to `useFrameLayout`,
// mode and selection to `canvasState`, which frames are live to `previewSlots`,
// and the strip to `BoardControls`. Spec §4's Select overlay is painted by
// `DesignFrame`; the board decides when flipping it is safe, because only it
// knows whether a wheel gesture is still arriving.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useReducedMotion } from 'framer-motion';
import { BoardControls } from './BoardControls';
import {
  alignRects,
  distributeRects,
  framesInBand,
  nudgeStep,
  sameRect,
  visibleDesignIds,
  type AlignEdge,
  type DistributeAxis,
  type PlacedFrame,
  type Point,
} from './canvasGeometry';
import {
  reduceBoardInteraction,
  type BoardHandle,
  type BoardInteraction,
  type BoardInteractionEvent,
  type BoardMode,
} from './canvasState';
import { DesignFrame } from './DesignFrame';
import { NO_PREVIEW_SLOTS, reducePreviewSlots, type PreviewSlotRequest } from './previewSlots';
import { useBoardGestures } from './useBoardGestures';
import { useBoardViewport } from './useBoardViewport';
import { useFrameLayout } from './useFrameLayout';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

export interface CanvasBoardProps {
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
  /** How the board's siblings focus a frame; see `BoardHandle`. */
  boardRef?: RefObject<BoardHandle | null>;
}

export function CanvasBoard({
  snapshot,
  onArrangeFrames,
  renderPreview,
  interaction,
  onInteractionChange,
  boardRef,
}: CanvasBoardProps) {
  const reducedMotion = useReducedMotion() === true;
  const board = useRef<HTMLDivElement>(null);
  const { frames } = snapshot;

  const view = useBoardViewport(board, frames, reducedMotion);
  const { fitTo } = view;
  const layout = useFrameLayout(frames, onArrangeFrames);

  const [slots, setSlots] = useState(NO_PREVIEW_SLOTS);
  const [overlayCapture, setOverlayCapture] = useState(interaction.mode === 'select');

  const { scale } = view.viewport;
  // Where every frame is drawn, which is what the queries below measure and
  // what a finished placement starts from.
  const drawn: PlacedFrame[] = frames.map((frame) => ({
    designId: frame.designId,
    rect: layout.rectOf(frame),
  }));
  // What the callbacks the gesture machine holds read, since they cannot close
  // over the render that registered them.
  const latest = useRef({ interaction, drawn, viewport: view.viewport });
  latest.current = { interaction, drawn, viewport: view.viewport };

  const dispatch = useCallback(
    (event: BoardInteractionEvent) => {
      const current = latest.current.interaction;
      const next = reduceBoardInteraction(current, event);
      if (next !== current) onInteractionChange(next);
    },
    [onInteractionChange],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: 'clear' });
  }, [dispatch]);

  const pickBand = useCallback(
    (origin: Point, current: Point, additive: boolean) => {
      const { drawn: placed, viewport } = latest.current;
      dispatch({
        type: 'pick-band',
        designIds: framesInBand(placed, viewport, origin, current),
        additive,
      });
    },
    [dispatch],
  );

  const gestures = useBoardGestures({
    board,
    view,
    layout,
    mode: interaction.mode,
    onClear: clearSelection,
    onBand: pickBand,
  });

  // Selection and Interact must never point at a design the canvas has lost.
  const designIds = useMemo(() => frames.map((frame) => frame.designId), [frames]);
  useEffect(() => {
    dispatch({ type: 'frames', designIds });
  }, [designIds, dispatch]);

  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  useImperativeHandle(boardRef, (): BoardHandle => ({ focusFrame: setFocusRequest }), []);

  // A focus asked for before its frame arrived waits for it rather than being
  // dropped: Open on an artifact card reaches the pane before the snapshot does.
  useEffect(() => {
    if (focusRequest === null) return;
    const target = frames.find((frame) => frame.designId === focusRequest);
    if (!target) return;
    setFocusRequest(null);
    fitTo([target.rect]);
    dispatch({ type: 'pick', designId: focusRequest, additive: false });
  }, [dispatch, fitTo, focusRequest, frames]);

  // Spec §11: at most four live previews. The request is a plain value, so the
  // key below is the whole of it and the reducer runs exactly when it changes.
  const slotRequest: PreviewSlotRequest = {
    designIds,
    visible: visibleDesignIds(drawn, view.viewport, view.size),
    interacted: interaction.interactedFrameId,
    selected: interaction.selectedFrameIds,
  };
  const slotKey = [
    slotRequest.designIds.join(),
    slotRequest.visible.join(),
    slotRequest.interacted,
    slotRequest.selected.join(),
  ].join('|');
  const pendingSlots = useRef(slotRequest);
  pendingSlots.current = slotRequest;
  useEffect(() => {
    setSlots((current) => reducePreviewSlots(current, pendingSlots.current));
  }, [slotKey]);

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
   * Frames the operation did not actually move are left out, so an align that
   * only moves one frame writes one frame.
   */
  const placeSelection = (nextRects: (rects: FrameRect[]) => FrameRect[]) => {
    const selected = frames.filter((frame) =>
      interaction.selectedFrameIds.includes(frame.designId),
    );
    const rects = selected.map((frame) => layout.rectOf(frame));
    const placed = nextRects(rects);
    layout.place(
      selected
        .map((frame, index) => ({
          designId: frame.designId,
          expectedLayoutVersion: frame.layoutVersion,
          rect: placed[index],
        }))
        .filter(({ rect }, index) => !sameRect(rect, rects[index])),
    );
  };

  const onBoardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Spec §4: the board's keys belong to the board and to its frames' headers,
    // which are the frames' tab stops. A control, an input or an editor inside
    // the board keeps its own.
    if (event.target !== event.currentTarget && !isFrameHeader(event.target)) return;
    if (event.key === ' ') {
      event.preventDefault();
      gestures.holdSpace(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // A gesture in flight is what Escape cancels first, which leaves the
      // acknowledged rect as the only one the board can draw. Only an Escape
      // with no gesture to spend on reaches the mode and the selection.
      if (!gestures.cancel()) dispatch({ type: 'escape' });
      return;
    }
    if (event.key === 'Enter' && interaction.selectedFrameIds.length === 1) {
      event.preventDefault();
      dispatch({ type: 'interact', designId: interaction.selectedFrameIds[0] });
      return;
    }
    const step = nudgeStep(event.key, event.shiftKey);
    if (step === null || interaction.selectedFrameIds.length === 0) return;
    event.preventDefault();
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
      className="relative h-full min-h-0 w-full overflow-hidden bg-droid-bg outline-none"
      style={{ cursor: gestures.cursor, touchAction: 'none' }}
      onPointerDown={gestures.startBackground}
      onPointerMove={gestures.track}
      onPointerUp={(event) => {
        gestures.end(event, true);
      }}
      onPointerCancel={(event) => {
        gestures.end(event, false);
      }}
      onLostPointerCapture={(event) => {
        gestures.end(event, false);
      }}
      onKeyDown={onBoardKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') gestures.holdSpace(false);
      }}
      onBlur={() => {
        gestures.holdSpace(false);
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${String(view.viewport.x)}px, ${String(view.viewport.y)}px) scale(${String(scale)})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {frames.map((frame, index) => (
          <DesignFrame
            key={frame.designId}
            frame={frame}
            rect={drawn[index].rect}
            scale={scale}
            mode={interaction.mode}
            selected={interaction.selectedFrameIds.includes(frame.designId)}
            interacted={interaction.interactedFrameId === frame.designId}
            held={layout.heldDesignId === frame.designId}
            capturePointer={overlayCapture}
            preview={slots.live.includes(frame.designId) ? renderPreview(frame) : null}
            released={slots.released.includes(frame.designId)}
            onHold={gestures.startFrame}
            onPick={(picked, additive) => {
              dispatch({ type: 'pick', designId: picked.designId, additive });
            }}
            onInteract={(picked) => {
              dispatch({ type: 'interact', designId: picked.designId });
            }}
          />
        ))}
      </div>

      {gestures.band && <RubberBand {...gestures.band} />}

      <BoardControls
        scale={scale}
        mode={interaction.mode}
        selectedCount={interaction.selectedFrameIds.length}
        hasFrames={frames.length > 0}
        error={layout.error}
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
function RubberBand({ origin, current }: { origin: Point; current: Point }) {
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

function isFrameHeader(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.dataset.frameHeader !== undefined;
}
