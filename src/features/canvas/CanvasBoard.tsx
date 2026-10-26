// The board: one transformed world layer holding the frames, the keyboard
// commands over it, the tool rail in its top-left corner and the zoom readout
// in its bottom-left.
//
// The board owns when the Select overlay can flip: the hit-test change waits
// for an active wheel gesture to finish.

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
import type { AnnotateCanvasInput } from './annotationProtocol';
import { AnnotationLayer, DrawSurface } from './AnnotationLayer';
import { AnnotationTools } from './AnnotationTools';
import { BoardControls, type ZoomCommand } from './BoardControls';
import { useBoardAnnouncer } from './boardAnnouncer';
import {
  frameHeaderOf,
  frameStep,
  isBoardControl,
  isBoardEditor,
  modeShortcut,
  readingOrder,
  zoomShortcut,
} from './boardKeys';
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
  showsFrameTools,
  type BoardInteraction,
  type BoardInteractionEvent,
  type BoardMode,
} from './canvasState';
import { DesignFrame } from './DesignFrame';
import { useCanvasMotion } from './useCanvasMotion';
import { useAnnotationEditor } from './useAnnotationEditor';
import { useBoardGestures, type Band } from './useBoardGestures';
import { useBoardPreviews } from './useBoardPreviews';
import { useBoardViewport } from './useBoardViewport';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

/** Board-local pixels one arrow key pans by when nothing is selected. */
const ARROW_PAN_PX = 32;

export interface CanvasBoardHandle {
  /** Centers the acknowledged frame and gives keyboard focus to the board. */
  focusFrame: (frameId: string) => void;
  /** Hands keyboard focus back to a frame's label, as a closing source panel does. */
  focusLabel: (frameId: string) => void;
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
  /** The one annotation write, bound to `CanvasClient.annotate` for this canvas. */
  onAnnotate: (input: AnnotateCanvasInput) => Promise<unknown>;
  /** One frame's live preview of `revisionId`, mounted only while it holds a slot. */
  renderPreview: (frame: CanvasFrame, revisionId: string) => ReactNode;
  /** Mode and selection, so the toolbar and navigator read the same values. */
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  /** This chat's agent has a turn running, so frames with no source are being written. */
  agentWorking: boolean;
  onOpenSource?: (designId: string) => void;
  /** The frames pinned to the chat's next prompt. */
  pinnedIds?: ReadonlySet<string>;
  /** Pins a frame to the chat's next prompt or takes it off; absent where frames cannot be pinned. */
  onToggleChat?: (frame: CanvasFrame) => void;
}

export function CanvasBoard({
  ref,
  snapshot,
  onArrangeFrames,
  onAnnotate,
  renderPreview,
  interaction,
  onInteractionChange,
  agentWorking,
  onOpenSource,
  pinnedIds,
  onToggleChat,
}: CanvasBoardProps) {
  const motion = useCanvasMotion();
  const board = useRef<HTMLDivElement>(null);
  const { frames } = snapshot;
  // The frames the board opened with are simply there; later ones arrive.
  const [openedWith] = useState(() => new Set(frames.map((frame) => frame.designId)));

  const view = useBoardViewport(board, frames, motion);
  const { fitTo } = view;
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

  const annotation = useAnnotationEditor({
    board,
    snapshot,
    viewport: view.viewport,
    interaction,
    dispatch,
    onAnnotate,
  });

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
    onClear: annotation.clearSelection,
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

  // The frames share one tab stop: the label focus last rested on, else the
  // selection, else the first frame a reader meets.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const order = readingOrder(drawn);
  const tabStopId = [focusedId, interaction.selectedFrameIds.at(0), order.at(0)].find(
    (designId) => designId != null && order.includes(designId),
  );
  const focusLabel = useCallback((designId: string) => {
    board.current
      ?.querySelector<HTMLElement>(
        `[data-design-frame="${CSS.escape(designId)}"] [data-frame-header]`,
      )
      ?.focus({ preventScroll: true });
  }, []);
  const onFocusLabel = (frame: CanvasFrame) => {
    setFocusedId(frame.designId);
    // A focused label must not scroll the clipped board under its transform.
    if (board.current) board.current.scrollTop = board.current.scrollLeft = 0;
    view.reveal(gestures.rectFor(frame));
  };

  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  useImperativeHandle(ref, (): CanvasBoardHandle => ({ focusFrame: setFocusRequest, focusLabel }), [
    focusLabel,
  ]);

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
  const previews = useBoardPreviews(frames, visible, interaction, renderPreview);
  const announcement = useBoardAnnouncer({
    frames,
    shown: previews.shown,
    selectedFrameIds: interaction.selectedFrameIds,
    focusedId,
    scale,
  });

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

  const onMode = (next: BoardMode) => {
    annotation.pickTool(null);
    if (next === interaction.mode) return;
    if (next === 'select') {
      dispatch({ type: 'escape' });
      return;
    }
    const target = interaction.selectedFrameIds.at(0) ?? frames.at(0)?.designId;
    if (target !== undefined) dispatch({ type: 'interact', designId: target });
  };

  const onZoom = (command: ZoomCommand) => {
    if (command === 'fit') fitTo(drawn.map(({ rect }) => rect));
    else if (command === 'selection')
      fitTo(
        drawn
          .filter(({ designId }) => interaction.selectedFrameIds.includes(designId))
          .map(({ rect }) => rect),
      );
    else if (command === 'actual') view.zoomTo(1);
    else view.stepZoom(command === 'in' ? 1 : -1);
  };

  /** Escape: a gesture first, then a tool, mode or selection; from a frame in Select, back to the board. */
  const onEscape = (header: string | null) => {
    if (gestures.cancel() || annotation.escape()) return;
    dispatch({ type: 'escape' });
    if (header !== null && interaction.mode === 'select')
      board.current?.focus({ preventScroll: true });
  };

  /** The zoom and mode keys, which the board's own tools take as well. */
  const runShortcut = (event: React.KeyboardEvent): boolean => {
    const zoom = zoomShortcut(event);
    if (zoom) onZoom(zoom);
    const mode = zoom ? null : modeShortcut(event);
    if (mode) onMode(mode);
    return zoom !== null || mode !== null;
  };

  /**
   * A key on the board or a frame's label. On a label the arrows, Home and End
   * move to another frame and select it, so Enter acts on the frame the
   * keyboard is on; there ⌥ and the arrows move the selection instead.
   */
  const runBoardKey = (event: React.KeyboardEvent, header: string | null): boolean => {
    const next = header === null ? null : frameStep(event, order, header);
    if (next !== null) {
      if (next !== header) {
        dispatch({ type: 'pick', designId: next, additive: false });
        focusLabel(next);
      }
      return true;
    }
    if (event.key === ' ') {
      gestures.holdSpace(true);
      return true;
    }
    if (event.key === 'Enter' && interaction.selectedFrameIds.length === 1) {
      dispatch({ type: 'interact', designId: interaction.selectedFrameIds[0] });
      return true;
    }
    const direction = arrowDirection(event.key);
    if (!direction || (header !== null && !event.altKey)) return false;
    if (interaction.selectedFrameIds.length === 0) {
      view.markNavigated();
      view.stopAnimating();
      view.panByScreen({ x: -direction.x * ARROW_PAN_PX, y: -direction.y * ARROW_PAN_PX });
      return true;
    }
    const step = nudgeStep(direction, event.shiftKey);
    placeSelection((rects) =>
      rects.map((rect) => ({ ...rect, x: rect.x + step.x, y: rect.y + step.y })),
    );
    return true;
  };

  const onBoardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Inputs and editors keep their shortcuts, including Escape.
    if (isBoardEditor(event.target)) return;
    const header = frameHeaderOf(event.target);
    // Board commands belong to the board and its frame labels. Its own tools take
    // the zoom and mode keys too, so a key still works after one was clicked;
    // Space, Enter and the arrows stay theirs.
    const onBoard = event.target === event.currentTarget || header !== null;
    let handled = false;
    if (event.key === 'Escape') {
      onEscape(header);
      handled = true;
    } else if (onBoard || isBoardControl(event.target)) {
      handled =
        runShortcut(event) || annotation.runKey(event) || (onBoard && runBoardKey(event, header));
    }
    if (handled) event.preventDefault();
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
        style={
          {
            transform: `translate(${String(view.viewport.x)}px, ${String(view.viewport.y)}px) scale(${String(scale)})`,
            transformOrigin: '0 0',
            // The board stylesheet divides frame chrome by this, so it keeps its size.
            '--board-scale': String(scale),
          } as React.CSSProperties
        }
      >
        {frames.map((frame, index) => (
          <DesignFrame
            key={frame.designId}
            canvasId={snapshot.canvasId}
            frame={frame}
            rect={drawn[index].rect}
            scale={scale}
            roomRight={view.size.x - (view.viewport.x + drawn[index].rect.x * scale)}
            motion={motion}
            arriving={!openedWith.has(frame.designId)}
            visible={visible.includes(frame.designId)}
            mode={interaction.mode}
            selected={interaction.selectedFrameIds.includes(frame.designId)}
            showTools={showsFrameTools(interaction, frame.designId)}
            interacted={interaction.interactedFrameId === frame.designId}
            held={gestures.heldDesignId === frame.designId}
            agentWorking={agentWorking}
            capturePointer={overlayCapture}
            shownRevisionId={previews.shown.get(frame.designId) ?? null}
            preview={previews.preview(frame)}
            released={previews.released.includes(frame.designId)}
            onExitInteract={() => {
              dispatch({ type: 'escape' });
              board.current?.focus({ preventScroll: true });
            }}
            onOpenSource={onOpenSource}
            inChat={pinnedIds?.has(frame.designId) ?? false}
            onToggleChat={onToggleChat}
            onHold={gestures.onFramePointerDown}
            onPick={(picked, additive) => {
              dispatch({ type: 'pick', designId: picked.designId, additive });
            }}
            onInteract={(picked) => {
              dispatch({ type: 'interact', designId: picked.designId });
            }}
            tabStop={frame.designId === tabStopId}
            onFocusLabel={onFocusLabel}
          />
        ))}
        <AnnotationLayer
          {...annotation.layer}
          scale={scale}
          interactive={capturePointer && annotation.tool === null && !gestures.spaceHeld}
        />
      </div>

      {annotation.tool && (
        <DrawSurface
          passThrough={gestures.spaceHeld}
          onPointerDown={annotation.onSurfacePointerDown}
        />
      )}
      {gestures.band && <RubberBand band={gestures.band} />}

      <BoardControls
        scale={scale}
        motion={motion}
        mode={interaction.mode}
        selectedCount={interaction.selectedFrameIds.length}
        hasFrames={frames.length > 0}
        error={gestures.layoutError || annotation.error}
        onMode={onMode}
        onZoom={onZoom}
        onAlign={(edge: AlignEdge) => {
          placeSelection((rects) => alignRects(rects, edge));
        }}
        onDistribute={(axis: DistributeAxis) => {
          placeSelection((rects) => distributeRects(rects, axis));
        }}
        annotationTools={<AnnotationTools {...annotation.rail} />}
      />

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** The rubber band, drawn in screen space above the world layer. */
function RubberBand({ band: { origin, current } }: { band: Band }) {
  return (
    <div
      aria-hidden
      className="canvas-band"
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
