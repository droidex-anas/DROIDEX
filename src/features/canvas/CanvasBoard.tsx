// The board: one transformed world layer holding the frames, the keyboard
// commands over it, the tool rail in its top-left corner and the zoom readout
// in its bottom-left.
//
// The board owns when the frames' input overlay can flip: the hit-test change waits
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
import { onBoardKeyDown } from './boardKeyDown';
import {
  alignRects,
  distributeRects,
  framesInBand,
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
import type { PreviewSelections } from './DesignPreview';
import type { EditElementInput, ElementEditResult } from './elementEditProtocol';
import { ElementPanel } from './ElementPanel';
import type { FrameActions } from './FrameToolbar';
import { useCanvasMotion } from './useCanvasMotion';
import { RubberBand } from './RubberBand';
import { useAnnotationEditor } from './useAnnotationEditor';
import { useBoardGestures } from './useBoardGestures';
import { useBoardPreviews } from './useBoardPreviews';
import { useBoardViewport } from './useBoardViewport';
import { useElementEditor } from './useElementEditor';
import { useFrameFocus } from './useFrameFocus';
import { useFrameRemoval } from './useFrameRemoval';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

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
  /** The one direct element edit, bound to `CanvasClient.source.editElement` for this canvas. */
  onEditElement: (input: EditElementInput) => Promise<ElementEditResult>;
  /** Deletes frames from this canvas (`FrameRemovals.remove`); true once they are gone. */
  onRemoveFrames: (frames: CanvasFrame[]) => Promise<boolean>;
  /** Undoes this canvas's latest deletion; false when none is offered. */
  onUndoRemoval: () => boolean;
  /**
   * One frame's live preview of `revisionId`, mounted only while it holds a
   * slot, reporting to the board's element editor through `selections`.
   */
  renderPreview: (
    frame: CanvasFrame,
    revisionId: string,
    selections: PreviewSelections,
  ) => ReactNode;
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
  /** What the selected frame's toolbar does to the canvas. */
  frameActions: FrameActions;
}

export function CanvasBoard({
  ref,
  snapshot,
  onArrangeFrames,
  onAnnotate,
  onEditElement,
  onRemoveFrames,
  onUndoRemoval,
  renderPreview,
  interaction,
  onInteractionChange,
  agentWorking,
  onOpenSource,
  pinnedIds,
  onToggleChat,
  frameActions,
}: CanvasBoardProps) {
  const motion = useCanvasMotion();
  const board = useRef<HTMLDivElement>(null);
  const { frames } = snapshot;
  // The frames the board opened with are simply there; later ones arrive.
  const [openedWith] = useState(() => new Set(frames.map((frame) => frame.designId)));

  const view = useBoardViewport(board, frames, motion);
  const { fitTo } = view;
  const [overlayCapture, setOverlayCapture] = useState(interaction.mode !== 'interact');
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

  const editor = useElementEditor({
    canvasId: snapshot.canvasId,
    frames,
    active: interaction.mode === 'edit',
    onEditElement,
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
    onClear: () => {
      annotation.clearSelection();
      editor.clear();
    },
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

  const { focusedId, order, tabStopId, focusFrame, focusLabel, onFocusLabel } = useFrameFocus({
    board,
    frames,
    drawn,
    selectedFrameIds: interaction.selectedFrameIds,
    dispatch,
    fitTo,
    reveal: view.reveal,
    rectFor: gestures.rectFor,
  });

  const removeSelection = useFrameRemoval({
    board,
    canvasId: snapshot.canvasId,
    frames,
    order,
    interaction,
    dispatch,
    focusLabel,
    onRemoveFrames,
  });

  useImperativeHandle(ref, (): CanvasBoardHandle => ({ focusFrame, focusLabel }), [
    focusFrame,
    focusLabel,
  ]);

  const visible = visibleDesignIds(drawn, view.viewport, view.size);
  const previews = useBoardPreviews(frames, visible, interaction, (frame, revisionId) =>
    renderPreview(frame, revisionId, editor.selections),
  );
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
  const capturePointer = interaction.mode !== 'interact';
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
    if (next === 'edit') {
      dispatch({ type: 'edit' });
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
      onKeyDown={(event) => {
        onBoardKeyDown(event, {
          interaction,
          order,
          dispatch,
          cancel: () => gestures.cancel() || annotation.escape() || editor.clear(),
          annotationKey: annotation.runKey,
          editKey: editor.runKey,
          zoom: onZoom,
          setMode: onMode,
          holdSpace: () => {
            gestures.holdSpace(true);
          },
          pan: (delta) => {
            view.markNavigated();
            view.stopAnimating();
            view.panByScreen(delta);
          },
          nudge: (step) => {
            placeSelection((rects) =>
              rects.map((rect) => ({ ...rect, x: rect.x + step.x, y: rect.y + step.y })),
            );
          },
          removeSelection,
          undoRemoval: onUndoRemoval,
          focusBoard: () => board.current?.focus({ preventScroll: true }),
          focusLabel,
        });
      }}
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
            actions={frameActions}
            onDelete={removeSelection}
            onHold={gestures.onFramePointerDown}
            onPick={(picked, additive) => {
              dispatch({ type: 'pick', designId: picked.designId, additive });
            }}
            onInteract={(picked) => {
              dispatch({ type: 'interact', designId: picked.designId });
            }}
            onPickElement={(picked, at) => {
              editor.pick(picked.designId, at);
            }}
            onEditEnter={(picked) => {
              editor.enter(picked.designId);
            }}
            elementBox={
              editor.selection?.draft.element.designId === frame.designId
                ? editor.selection.shown.rect
                : null
            }
            tabStop={frame.designId === tabStopId}
            onFocusLabel={onFocusLabel}
          />
        ))}
        <AnnotationLayer
          {...annotation.layer}
          scale={scale}
          interactive={
            interaction.mode === 'select' && annotation.tool === null && !gestures.spaceHeld
          }
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
        error={gestures.layoutError || annotation.error || editor.error}
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
      {editor.selection && (
        <ElementPanel
          ref={editor.panel}
          selection={editor.selection}
          onPreview={editor.preview}
          onRevert={editor.revert}
          onCommit={editor.commit}
          onLeave={() => board.current?.focus({ preventScroll: true })}
        />
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

interface BoardReads {
  interaction: BoardInteraction;
  drawn: PlacedFrame[];
  viewport: Viewport;
}
