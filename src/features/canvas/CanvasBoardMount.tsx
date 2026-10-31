// The board, bound to the canvas it is showing, or the design system document
// shown in its place (spec §4). The document swaps in below the workspace, so
// the canvas projection and its subscription stay; the board's live previews
// go with the board and its viewport waits in the pane state for Back.

import { lazy, Suspense, useCallback, useEffect, useMemo, type RefObject } from 'react';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { showBoard } from './boardOnScreen';
import { CanvasBoard, type CanvasBoardHandle } from './CanvasBoard';
import { canvasClient as canvas, frameRemovals, reportPreview } from './canvasClient';
import { useCoverCapture } from './canvasCovers';
import type { Viewport } from './canvasGeometry';
import { CanvasInvitation, CanvasToolsMissing } from './CanvasPaneStates';
import { lacksCanvasTools, type BoardInteraction } from './canvasState';
import type { AnnotateCanvasInput } from './annotationProtocol';
import { DesignPreview } from './DesignPreview';
import type { EditElementInput } from './elementEditProtocol';
import { syncFramePins, toggleFramePin, useFramePins } from './framePins';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot } from './protocol';
import { useFrameActions } from './useFrameActions';

const LazyDesignSystemDocument = lazy(async () => ({
  default: (await import('./systemDocument/DesignSystemDocument')).DesignSystemDocument,
}));

const readArtifact = canvas.readArtifact.bind(canvas);

export interface ShownDocument {
  id: string;
  version?: number;
}

/**
 * A canvas whose frames were all deleted presents the invitation instead of
 * the board (spec §4), because an empty board is not an answer to "what do I
 * do here".
 */
export function CanvasBoardMount({
  appSessionId,
  snapshot,
  restoredViewport,
  shownDocument,
  onLeaveBoard,
  pinnable,
  interaction,
  onInteractionChange,
  boardRef,
  onOpenSource,
}: {
  appSessionId: string;
  snapshot: CanvasSnapshot;
  restoredViewport: Viewport | undefined;
  shownDocument: ShownDocument | null;
  onLeaveBoard: (viewport: Viewport) => void;
  /** It is the chat's own canvas, so its frames can be pinned to the chat's next prompt. */
  pinnable: boolean;
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  boardRef: RefObject<CanvasBoardHandle | null>;
  onOpenSource: (designId: string) => void;
}) {
  const { canvasId } = snapshot;
  const dispatch = useStoreDispatch();
  const agentWorking = useSessionLive(appSessionId);
  const toolsMissing = useStoreSelector((current) =>
    lacksCanvasTools(current.sessions[appSessionId]),
  );
  const arrangeFrames = useCallback(
    (input: ArrangeFramesInput) => canvas.arrangeFrames(appSessionId, canvasId, input),
    [appSessionId, canvasId],
  );
  const annotate = useCallback(
    (input: AnnotateCanvasInput) => canvas.annotate(appSessionId, canvasId, input),
    [appSessionId, canvasId],
  );
  const editElement = useCallback(
    (input: EditElementInput) => canvas.source.editElement(appSessionId, canvasId, input),
    [appSessionId, canvasId],
  );
  const removeFrames = useCallback(
    (removing: CanvasFrame[]) => frameRemovals.remove(appSessionId, canvasId, removing),
    [appSessionId, canvasId],
  );
  const undoRemoval = useCallback(() => frameRemovals.undoLatest(canvasId), [canvasId]);
  const frameActions = useFrameActions(appSessionId, canvasId, pinnable);
  const pins = useFramePins(appSessionId);
  const pinnedIds = useMemo(
    () => new Set(pins.filter((pin) => pin.canvasId === canvasId).map((pin) => pin.designId)),
    [pins, canvasId],
  );
  useEffect(
    () => (pinnable ? syncFramePins(appSessionId, snapshot) : undefined),
    [appSessionId, pinnable, snapshot],
  );
  const { frames } = snapshot;
  useCoverCapture(canvasId, frames);
  const { selectedFrameIds } = interaction;
  const showingDocument = shownDocument !== null;
  useEffect(() => {
    const byId = new Map(frames.map((frame) => [frame.designId, frame]));
    return showBoard({
      appSessionId,
      canvasId,
      attached: pinnable,
      agentWorking,
      frames,
      selected: selectedFrameIds
        .map((designId) => byId.get(designId))
        .filter((frame): frame is CanvasFrame => frame !== undefined),
      focusFrame: (designId) => {
        // A frame asked for over the document brings the board back, focused on it.
        if (showingDocument)
          dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'canvas', appSessionId, frameId: designId });
        else boardRef.current?.focusFrame(designId);
      },
    });
  }, [
    agentWorking,
    appSessionId,
    boardRef,
    canvasId,
    dispatch,
    frames,
    pinnable,
    selectedFrameIds,
    showingDocument,
  ]);

  if (shownDocument)
    return (
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <LazyDesignSystemDocument
            appSessionId={appSessionId}
            canvasKey={canvasId}
            system={shownDocument}
            onBack={() => {
              dispatch({
                type: 'OPEN_UTILITY_TOOL',
                tool: 'canvas',
                appSessionId,
                designSystemId: null,
                designSystemVersion: null,
              });
            }}
          />
        </Suspense>
      </div>
    );

  return (
    <div data-canvas-board className="min-h-0 flex-1">
      {snapshot.frames.length === 0 ? (
        toolsMissing ? (
          <CanvasToolsMissing canvasId={canvasId} />
        ) : (
          <CanvasInvitation />
        )
      ) : (
        <CanvasBoard
          ref={boardRef}
          snapshot={snapshot}
          restoredViewport={restoredViewport}
          onLeave={onLeaveBoard}
          onOpenSource={onOpenSource}
          onArrangeFrames={arrangeFrames}
          onAnnotate={annotate}
          onEditElement={editElement}
          onRemoveFrames={removeFrames}
          onUndoRemoval={undoRemoval}
          interaction={interaction}
          onInteractionChange={onInteractionChange}
          agentWorking={agentWorking}
          pinnedIds={pinnedIds}
          frameActions={frameActions.actions}
          onToggleChat={
            pinnable
              ? (frame) => {
                  toggleFramePin(appSessionId, canvasId, frame);
                }
              : undefined
          }
          renderPreview={(frame, revisionId, selections) => (
            <DesignPreview
              canvasId={canvasId}
              frame={frame}
              revisionId={revisionId}
              readArtifact={readArtifact}
              reportPreview={reportPreview}
              selections={selections}
            />
          )}
        />
      )}
      {frameActions.dialog}
    </div>
  );
}
