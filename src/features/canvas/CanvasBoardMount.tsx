// The board, bound to the canvas it is showing, or the design system document
// shown in its place (spec §4). The document swaps in below the workspace, so
// the canvas projection and its subscription stay; the board's live previews
// go with the board and its viewport waits in the pane state for Back. Kits
// belong to no canvas, so a chat without one shows a kit's document too.

import { lazy, Suspense, useCallback, useEffect, useMemo, type RefObject } from 'react';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { showBoard } from './boardOnScreen';
import { CanvasBoard, type CanvasBoardHandle } from './CanvasBoard';
import { recordPlacements, revisionEntry, type HistoryStep } from './boardHistory';
import { boardHistory, canvasClient as canvas, frameRemovals, reportPreview } from './canvasClient';
import { useCoverCapture } from './canvasCovers';
import type { Viewport } from './canvasGeometry';
import { CanvasInvitation, CanvasToolsMissing } from './CanvasPaneStates';
import { lacksCanvasTools, type BoardInteraction } from './canvasState';
import type { AnnotateCanvasInput } from './annotationProtocol';
import { DesignPreview } from './DesignPreview';
import type { EditElementInput } from './elementEditProtocol';
import { pickElement, syncElementPins, unpinElements, useElementPins } from './elementPins';
import { syncFramePins, toggleFramePins, useFramePins } from './framePins';
import type {
  ArrangeFramesInput,
  CanvasFrame,
  CanvasSnapshot,
  SwitchRevisionInput,
} from './protocol';
import { useCanvasPresence } from './useCanvasPresence';
import type { DesignPins } from './useDesignPicker';
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
  /** It is the chat's own canvas, so its frames can be tagged in the chat's next prompt. */
  pinnable: boolean;
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  boardRef: RefObject<CanvasBoardHandle | null>;
  onOpenSource: (designId: string) => void;
}) {
  const { canvasId, frames } = snapshot;
  const dispatch = useStoreDispatch();
  const agentWorking = useSessionLive(appSessionId);
  const toolsMissing = useStoreSelector((current) =>
    lacksCanvasTools(current.sessions[appSessionId]),
  );
  const arrangeFrames = useMemo(
    () =>
      recordPlacements(
        boardHistory,
        canvasId,
        (input: ArrangeFramesInput) => canvas.arrangeFrames(appSessionId, canvasId, input),
        () => canvas.snapshotOf(canvasId)?.frames ?? [],
      ),
    [appSessionId, canvasId],
  );
  const annotate = useCallback(
    (input: AnnotateCanvasInput) => canvas.annotate(appSessionId, canvasId, input),
    [appSessionId, canvasId],
  );
  const switchRevision = useCallback(
    (input: SwitchRevisionInput) => canvas.revisions.switchTo(appSessionId, canvasId, input),
    [appSessionId, canvasId],
  );
  // Each edit that made a revision is a step in the board's history.
  const editElement = useCallback(
    async (input: EditElementInput) => {
      const receipt = await canvas.source.editElement(appSessionId, canvasId, input);
      const { designId, revisionId } = input.edit.element;
      const frame = frames.find((each) => each.designId === designId);
      if (frame && receipt.revisionId !== revisionId)
        boardHistory.record(
          canvasId,
          revisionEntry(
            switchRevision,
            { designId, name: frame.name },
            revisionId,
            receipt.revisionId,
          ),
        );
      return receipt;
    },
    [appSessionId, canvasId, frames, switchRevision],
  );
  const removeFrames = useCallback(
    (removing: CanvasFrame[]) => frameRemovals.remove(appSessionId, canvasId, removing),
    [appSessionId, canvasId],
  );
  const stepHistory = useCallback(
    (step: HistoryStep) =>
      step === 'undo' ? boardHistory.undo(canvasId) : boardHistory.redo(canvasId),
    [canvasId],
  );
  const frameActions = useFrameActions(appSessionId, canvasId, pinnable, frames);
  const pins = useFramePins(appSessionId);
  const pinnedIds = useMemo(
    () => new Set(pins.filter((pin) => pin.canvasId === canvasId).map((pin) => pin.designId)),
    [pins, canvasId],
  );
  const allElementPins = useElementPins(appSessionId);
  const design = useMemo((): DesignPins | undefined => {
    if (!pinnable) return undefined;
    const pins = allElementPins.filter((pin) => pin.canvasId === canvasId);
    return {
      chatId: appSessionId,
      pins,
      pick: (frame, element, additive) =>
        pickElement(appSessionId, canvasId, frame, element, additive),
      clear: () => {
        unpinElements(appSessionId, pins);
      },
      seed: (text, send) => {
        dispatch({ type: 'SEED_COMPOSER', appSessionId, text, send, focus: false });
      },
    };
  }, [allElementPins, appSessionId, canvasId, dispatch, pinnable]);
  useEffect(() => {
    if (!pinnable) return;
    syncElementPins(appSessionId, snapshot);
    return syncFramePins(appSessionId, snapshot);
  }, [appSessionId, pinnable, snapshot]);
  useCoverCapture(canvasId, frames);
  const presence = useCanvasPresence(appSessionId, frames);
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
    return <DocumentMount appSessionId={appSessionId} canvasId={canvasId} shown={shownDocument} />;

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
          onHistory={stepHistory}
          interaction={interaction}
          onInteractionChange={onInteractionChange}
          presence={presence}
          pinnedIds={pinnedIds}
          design={design}
          frameActions={frameActions.actions}
          onTagFrames={
            pinnable
              ? (designIds) => {
                  const tagging = designIds.flatMap((designId) =>
                    frames.filter((frame) => frame.designId === designId),
                  );
                  toggleFramePins(appSessionId, canvasId, tagging);
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

/** A design system document in the pane; `canvasId` is null in a chat without a canvas. */
export function DocumentMount({
  appSessionId,
  canvasId,
  shown,
}: {
  appSessionId: string;
  canvasId: string | null;
  shown: ShownDocument;
}) {
  const dispatch = useStoreDispatch();
  return (
    <div className="min-h-0 flex-1">
      <Suspense fallback={null}>
        <LazyDesignSystemDocument
          appSessionId={appSessionId}
          canvasKey={canvasId}
          system={shown}
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
}
