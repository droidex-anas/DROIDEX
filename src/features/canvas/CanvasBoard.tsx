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
import { DrawSurface } from './AnnotationLayer';
import { AnnotationTools } from './AnnotationTools';
import { boardCommands } from './boardCommands';
import { BoardControls } from './BoardControls';
import { BoardOverlays } from './BoardOverlays';
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
import { picksElements, showsFrameTools, type BoardInteraction } from './canvasState';
import type { CanvasPresence, LandedWrites } from './canvasPresence';
import { DesignFrame } from './DesignFrame';
import { DesignPickPrompt } from './DesignPickPrompt';
import type { PreviewSelections } from './DesignPreview';
import type { EditElementInput } from './elementEditProtocol';
import { ElementPanel, EmptyElementPanel } from './ElementPanel';
import type { FrameActions } from './FrameToolbar';
import { PreviewRuns } from './previewRuns';
import { useCanvasMotion } from './useCanvasMotion';
import type { ReadSource } from './useChangeTours';
import { RubberBand } from './RubberBand';
import { SnapGuides } from './SnapGuides';
import { toolbarRoom } from './toolbarPlacement';
import { useAnnotationEditor } from './useAnnotationEditor';
import { useBoardGestures } from './useBoardGestures';
import { useBoardPreviews } from './useBoardPreviews';
import { useBoardToastPlacement } from './useBoardToastPlacement';
import { useBoardViewport } from './useBoardViewport';
import { useDesignPicker, type DesignPins } from './useDesignPicker';
import { useElementEditor } from './useElementEditor';
import { useFrameFocus } from './useFrameFocus';
import { useFrameRemoval } from './useFrameRemoval';
import { useHoverMeasurements } from './useHoverMeasurements';
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
  presence: CanvasPresence;
  writes: LandedWrites;
  /** One revision's source, bound to `CanvasClient.source.read` for this canvas. */
  readSource: ReadSource;
  onOpenSource?: (designId: string) => void;
  /** The frames tagged in the chat's next prompt. */
  pinnedIds?: ReadonlySet<string>;
  /** Tags frames in the chat's next prompt, or untags them; absent where frames cannot be tagged. */
  onTagFrames?: (designIds: readonly string[]) => void;
  /** What Design points the chat's next prompt at; absent where it cannot, as frames cannot be tagged. */
  design?: DesignPins;
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
  presence,
  writes,
  readSource,
  onOpenSource,
  pinnedIds,
  onTagFrames,
  design,
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
  useBoardToastPlacement(board, rightInset, interaction.selectedFrameIds.length >= 2);
  // What the callbacks the gesture machine holds read, since they cannot close
  // over the render that registered them. Filled in below, once the rects the
  // board actually draws are known.
  const latest = useRef<{ drawn: PlacedFrame[]; viewport: Viewport }>({
    drawn: [],
    viewport: view.viewport,
  });
  const canDesign = design !== undefined;
  const dispatch = useInteractionDispatch(interaction, onInteractionChange, frames, canDesign);

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

  const [previewRuns] = useState(() => new PreviewRuns());
  const editor = useElementEditor({
    canvasId: snapshot.canvasId,
    frames,
    runs: previewRuns,
    active: interaction.mode === 'edit',
    hovering: picksElements(interaction.mode),
    onEditElement,
  });
  const picker = useDesignPicker({
    frames,
    runs: previewRuns,
    active: interaction.mode === 'design',
    design,
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

  const measured = useHoverMeasurements(board, drawn, interaction, editor);
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
    canDesign,
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
    // Edit's element panel is a full-height column beside the board, not a
    // layer over it, so it takes its own wheel and the board only gives up
    // width; the board's view keeps its top-left, so no frame moves as it opens.
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
            cancel: () =>
              gestures.cancel() || annotation.escape() || editor.clear() || picker.clear(),
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
            tagFrames: onTagFrames,
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
              motion={motion}
              arriving={!openedWith.has(frame.designId)}
              visible={visible.includes(frame.designId)}
              mode={interaction.mode}
              selected={interaction.selectedFrameIds.includes(frame.designId)}
              multiSelect={interaction.selectedFrameIds.length > 1}
              toolbarRoom={
                showsFrameTools(interaction, frame.designId)
                  ? toolbarRoom(view.viewport, drawn, frame.designId, view.size)
                  : null
              }
              interacted={interaction.interactedFrameId === frame.designId}
              held={gestures.heldDesignIds.includes(frame.designId)}
              worker={presence.get(frame.designId)?.agent}
              capturePointer={overlayCapture}
              shownRevisionId={previews.shown.get(frame.designId) ?? null}
              preview={previews.preview(frame)}
              released={previews.released.includes(frame.designId)}
              onExitInteract={() => {
                dispatch({ type: 'escape' });
                focusBoard();
              }}
              onOpenSource={onOpenSource}
              tagged={pinnedIds?.has(frame.designId) ?? false}
              onTagFrames={onTagFrames}
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
              onDesignPress={picker.press}
              onHoverElement={(hovered, at) => {
                if (at) editor.hover.move(hovered.designId, at);
                else editor.hover.clear();
              }}
              onEditEnter={(picked) => {
                editor.enter(picked.designId);
              }}
              elementPicked={editor.selection?.draft.element.designId === frame.designId}
              elementHovered={editor.hover.hovered?.designId === frame.designId}
              tabStop={frame.designId === tabStopId}
              onFocusLabel={onFocusLabel}
            />
          ))}
          <BoardOverlays
            frames={frames}
            drawn={drawn}
            visible={visible}
            scale={scale}
            motion={motion}
            presence={presence}
            writes={writes}
            runs={previewRuns}
            readSource={readSource}
            selection={editor.selection}
            hovered={editor.hover.hovered}
            hoveredComponent={picker.componentOf(editor.hover.hovered)}
            picks={picker.outlines}
            interaction={interaction}
            marks={annotation.layer}
            pointerTaken={annotation.tool !== null || gestures.spaceHeld}
          />
        </div>

        {annotation.tool && (
          <DrawSurface
            passThrough={gestures.spaceHeld}
            onPointerDown={annotation.onSurfacePointerDown}
          />
        )}
        {gestures.band && <RubberBand band={gestures.band} />}
        <SnapGuides marks={gestures.snapMarks ?? measured} viewport={view.viewport} />
        {picker.prompt && (
          <DesignPickPrompt
            {...picker.prompt}
            drawn={drawn}
            viewport={view.viewport}
            size={view.size}
            motion={motion}
            focusBoard={focusBoard}
          />
        )}

        <BoardControls
          scale={scale}
          motion={motion}
          mode={interaction.mode}
          selectedCount={interaction.selectedFrameIds.length}
          hasFrames={frames.length > 0}
          canDesign={canDesign}
          errors={[gestures.layoutError, annotation.error, editor.error, picker.error]}
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
      {interaction.mode === 'edit' && !editor.selection && <EmptyElementPanel />}
      {editor.selection && (
        <ElementPanel
          ref={editor.panel}
          selection={editor.selection}
          frameName={
            frames.find((frame) => frame.designId === editor.selection?.draft.element.designId)
              ?.name ?? ''
          }
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
