// The board: one transformed world layer holding the frames, the keyboard
// commands over it, the tool rail in its top-left corner and the zoom readout
// in its bottom-left.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import type { AnnotateCanvasInput } from './annotationProtocol';
import { AnnotationLayer, DrawSurface } from './AnnotationLayer';
import { AnnotationTools } from './AnnotationTools';
import { boardCommands } from './boardCommands';
import { BoardControls } from './BoardControls';
import { useBoardAnnouncer } from './boardAnnouncer';
import type { HistoryStep } from './boardHistory';
import { onBoardKeyDown } from './boardKeyDown';
import {
  framesInBand,
  visibleDesignIds,
  type PlacedFrame,
  type Point,
  type Viewport,
} from './canvasGeometry';
import { showsFrameTools, type BoardInteraction } from './canvasState';
import { DesignFrame } from './DesignFrame';
import type { PreviewSelections } from './DesignPreview';
import type { EditElementInput } from './elementEditProtocol';
import { ElementPanel } from './ElementPanel';
import type { FrameActions } from './FrameToolbar';
import { useCanvasMotion } from './useCanvasMotion';
import { RubberBand } from './RubberBand';
import { SelectionBounds } from './SelectionBounds';
import { SnapGuides } from './SnapGuides';
import { useAnnotationEditor } from './useAnnotationEditor';
import { useBoardGestures } from './useBoardGestures';
import { useBoardPreviews } from './useBoardPreviews';
import { useBoardViewport } from './useBoardViewport';
import { useElementEditor } from './useElementEditor';
import { useFrameFocus } from './useFrameFocus';
import { useFrameRemoval } from './useFrameRemoval';
import { useInteractionDispatch } from './useInteractionDispatch';
import { useOverlayCapture } from './useOverlayCapture';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, WriteReceipt } from './protocol';

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
   * a nudge, an align or a distribute. `CanvasBoardMount` binds it to
   * `CanvasClient.arrangeFrames` for this canvas, each write a step of its history.
   */
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>;
  /** The one annotation write, bound to `CanvasClient.annotate` for this canvas. */
  onAnnotate: (input: AnnotateCanvasInput) => Promise<unknown>;
  /** The one direct element edit, bound to `CanvasClient.source.editElement` for this canvas. */
  onEditElement: (input: EditElementInput) => Promise<WriteReceipt>;
  /** Deletes frames from this canvas (`FrameRemovals.remove`); true once they are gone. */
  onRemoveFrames: (frames: CanvasFrame[]) => Promise<boolean>;
  /** ⌘Z and its kin on the board or the element panel; false when there is no step. */
  onHistory: (step: HistoryStep) => boolean;
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
  /** Where the board was left for a document; it reopens there instead of fitting. */
  restoredViewport?: Viewport;
  /** Hands the viewport over as the board unmounts, so Back from a document can restore it. */
  onLeave?: (viewport: Viewport) => void;
  /**
   * Screen pixels along the board's right edge that a panel docked over it
   * covers. Fit, zoom, focus and the frame toolbar keep to the rest; a panel
   * laid out beside the board needs none, since the board measures without it.
   */
  rightInset?: number;
}

export function CanvasBoard({
  ref,
  snapshot,
  onArrangeFrames,
  onAnnotate,
  onEditElement,
  onRemoveFrames,
  onHistory,
  renderPreview,
  interaction,
  onInteractionChange,
  agentWorking,
  onOpenSource,
  pinnedIds,
  onToggleChat,
  frameActions,
  restoredViewport,
  onLeave,
  rightInset = 0,
}: CanvasBoardProps) {
  const motion = useCanvasMotion();
  const board = useRef<HTMLDivElement>(null);
  const { frames } = snapshot;
  // The frames the board opened with are simply there; later ones arrive.
  const [openedWith] = useState(() => new Set(frames.map((frame) => frame.designId)));

  const view = useBoardViewport(board, frames, motion, restoredViewport, rightInset);
  const { fitTo } = view;
  // What the callbacks the gesture machine holds read, since they cannot close
  // over the render that registered them. Filled in below, once the rects the
  // board actually draws are known.
  const latest = useRef<BoardReads>({ drawn: [], viewport: view.viewport });
  const dispatch = useInteractionDispatch(interaction, onInteractionChange, frames);

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
    reveal: view.reveal,
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
    selectedFrameIds: interaction.selectedFrameIds,
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
  latest.current = { drawn, viewport: view.viewport };

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

  useEffect(() => {
    const reads = latest;
    return () => {
      onLeave?.(reads.current.viewport);
    };
  }, [onLeave]);

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

  const overlayCapture = useOverlayCapture(interaction.mode !== 'interact', view.scrolling);

  const commands = boardCommands({
    interaction,
    frames,
    drawn,
    dispatch,
    dropTool: () => {
      annotation.pickTool(null);
    },
    fitTo,
    zoomTo: view.zoomTo,
    stepZoom: view.stepZoom,
    place: gestures.place,
  });

  const focusBoard = () => board.current?.focus({ preventScroll: true });

  return (
    // The element panel is a column beside the board, not a layer over it, so
    // it takes its own wheel and the board only gives up width.
    <div className="flex h-full min-h-0 w-full bg-bg">
      <div
        ref={board}
        data-testid="canvas-board"
        data-board-mode={interaction.mode}
        tabIndex={0}
        aria-label="Design board"
        className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-bg outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-ring"
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
            zoom: commands.zoom,
            setMode: commands.setMode,
            holdSpace: () => {
              gestures.holdSpace(true);
            },
            pan: (delta) => {
              view.markNavigated();
              view.stopAnimating();
              view.panByScreen(delta);
            },
            nudge: commands.nudge,
            removeSelection,
            history: onHistory,
            focusBoard,
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
              multiSelect={interaction.selectedFrameIds.length > 1}
              showTools={showsFrameTools(interaction, frame.designId)}
              interacted={interaction.interactedFrameId === frame.designId}
              held={gestures.heldDesignIds.includes(frame.designId)}
              agentWorking={agentWorking}
              capturePointer={overlayCapture}
              shownRevisionId={previews.shown.get(frame.designId) ?? null}
              preview={previews.preview(frame)}
              released={previews.released.includes(frame.designId)}
              onExitInteract={() => {
                dispatch({ type: 'escape' });
                focusBoard();
              }}
              onOpenSource={onOpenSource}
              inChat={pinnedIds?.has(frame.designId) ?? false}
              onToggleChat={onToggleChat}
              actions={frameActions}
              onDelete={removeSelection}
              onHold={gestures.onFramePointerDown}
              onResize={commands.resize}
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
          <SelectionBounds drawn={drawn} selectedFrameIds={interaction.selectedFrameIds} />
          <AnnotationLayer
            {...annotation.layer}
            frames={frames}
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
        {gestures.snapMarks && <SnapGuides marks={gestures.snapMarks} viewport={view.viewport} />}

        <BoardControls
          scale={scale}
          motion={motion}
          mode={interaction.mode}
          selectedCount={interaction.selectedFrameIds.length}
          hasFrames={frames.length > 0}
          error={gestures.layoutError || annotation.error || editor.error}
          onMode={commands.setMode}
          onZoom={commands.zoom}
          onZoomTo={view.zoomTo}
          focusBoard={focusBoard}
          onAlign={commands.align}
          onDistribute={commands.distribute}
          annotationTools={<AnnotationTools {...annotation.rail} />}
        />

        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
      {editor.selection && (
        <ElementPanel
          ref={editor.panel}
          selection={editor.selection}
          tokens={editor.tokens}
          mode={editor.mode}
          onPreview={editor.preview}
          onRevert={editor.revert}
          onCommit={editor.commit}
          onPreviewText={editor.previewText}
          onRevertText={editor.revertText}
          onCommitText={editor.commitText}
          onHistory={onHistory}
          onLeave={focusBoard}
        />
      )}
    </div>
  );
}

interface BoardReads {
  drawn: PlacedFrame[];
  viewport: Viewport;
}
