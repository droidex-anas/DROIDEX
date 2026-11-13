// The board, bound to the canvas it is showing, or the design system document
// shown in its place (spec §4). The document swaps in below the workspace, so
// the canvas projection and its subscription stay; the board's live previews
// go with the board and its viewport waits in the pane state for Back. Kits
// belong to no canvas, so a chat without one shows a kit's document too.

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { toast } from '../../lib/toast';
import { isBoardEditor, sidePanelKey, type SidePanelTab } from './boardKeys';
import { showBoard } from './boardOnScreen';
import { CanvasBoard, type CanvasBoardHandle } from './CanvasBoard';
import { recordPlacements, revisionEntry, type HistoryStep } from './boardHistory';
import { boardHistory, canvasClient as canvas, frameRemovals, reportPreview } from './canvasClient';
import { useCoverCapture } from './canvasCovers';
import type { Viewport } from './canvasGeometry';
import { canvasMessage } from './client';
import { TaggingChat } from './componentTagging';
import { CanvasInvitation, CanvasToolsMissing } from './CanvasPaneStates';
import {
  lacksCanvasTools,
  picksElements,
  reduceBoardInteraction,
  type BoardInteraction,
} from './canvasState';
import type { AnnotateCanvasInput } from './annotationProtocol';
import { DesignPreview, type PreviewSelections } from './DesignPreview';
import type { EditElementInput, LayerChange, LayerRef } from './elementEditProtocol';
import { pickElement, syncElementPins, unpinElements, useElementPins } from './elementPins';
import { syncFramePins, toggleFramePins, useFramePins } from './framePins';
import { layerElements } from './layers/layerElements';
import { LayersPanel } from './layers/LayersPanel';
import { SidePanel } from './layers/SidePanel';
import { ComponentsPanel } from './palette/ComponentsPanel';
import { useComponentInsert } from './palette/useComponentInsert';
import { PreviewRuns } from './previewRuns';
import type {
  ArrangeFramesInput,
  CanvasFrame,
  CanvasSnapshot,
  SwitchRevisionInput,
} from './protocol';
import { useCanvasPresence, useLandedWrites } from './useCanvasPresence';
import { useBoardPaste } from './useBoardPaste';
import type { DesignPins } from './useDesignPicker';
import { useElementEditor } from './useElementEditor';
import { useFrameActions } from './useFrameActions';

const LazyDesignSystemDocument = lazy(async () => ({
  default: (await import('./systemDocument/DesignSystemDocument')).DesignSystemDocument,
}));

const readArtifact = canvas.readArtifact.bind(canvas);

const LAYER_EDIT_VERBS: Record<Exclude<LayerChange['kind'], 'hide'>, string> = {
  move: 'move',
  remove: 'delete',
  duplicate: 'duplicate',
  insert: 'add to',
};

function layerEditVerb(change: LayerChange): string {
  if (change.kind !== 'hide') return LAYER_EDIT_VERBS[change.kind];
  return change.hidden ? 'hide' : 'show';
}

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
  layersOpen,
  onShowLayers,
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
  /** The side panel, on Layers or Components, stands at the board's left. */
  layersOpen: boolean;
  onShowLayers: (shown: boolean) => void;
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
      const edited = await canvas.source.editElement(appSessionId, canvasId, input);
      const { receipt } = edited;
      const { designId, revisionId } =
        'element' in input.edit ? input.edit.element : input.edit.layer;
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
      return edited;
    },
    [appSessionId, canvasId, frames, switchRevision],
  );
  const renderPreview = useCallback(
    (frame: CanvasFrame, revisionId: string, selections: PreviewSelections) => (
      <DesignPreview
        canvasId={canvasId}
        frame={frame}
        revisionId={revisionId}
        readArtifact={readArtifact}
        reportPreview={reportPreview}
        selections={selections}
      />
    ),
    [canvasId],
  );
  const readSource = useCallback(
    (designId: string, revisionId: string) => canvas.source.read(canvasId, designId, revisionId),
    [canvasId],
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
  const writes = useLandedWrites(appSessionId);
  const boardArea = useRef<HTMLDivElement>(null);
  const shownFrames = useMemo(() => frames.filter((frame) => !frame.hidden), [frames]);
  const isShown = (designId: string) => shownFrames.some((frame) => frame.designId === designId);
  const [runs] = useState(() => new PreviewRuns());
  const editor = useElementEditor({
    canvasId,
    frames: shownFrames,
    runs,
    active: interaction.mode === 'edit',
    hovering: picksElements(interaction.mode),
    onEditElement: editElement,
  });
  const setFrameHidden = (frame: CanvasFrame, hidden: boolean) => {
    const input = {
      mutationId: crypto.randomUUID(),
      designId: frame.designId,
      hidden,
      expectedManifestVersion: frame.manifestVersion,
    };
    canvas.layers.setHidden(appSessionId, canvasId, input).catch((error: unknown) => {
      toast.error(`Couldn’t ${hidden ? 'hide' : 'show'} ${frame.name}. ${canvasMessage(error)}`);
    });
  };
  const reorderFrames = (designIds: string[]) => {
    const input = { mutationId: crypto.randomUUID(), designIds };
    canvas.layers.reorder(appSessionId, canvasId, input).catch((error: unknown) => {
      toast.error(`Couldn’t restack the frames. ${canvasMessage(error)}`);
    });
  };
  const editLayer = async (layer: LayerRef, change: LayerChange) => {
    try {
      return await editor.editLayer(layer, change);
    } catch (error) {
      toast.error(`Couldn’t ${layerEditVerb(change)} the layer. ${canvasMessage(error)}`);
      return null;
    }
  };
  const { selectedFrameIds } = interaction;
  const layerEdits = frameActions.actions.canEdit ? editLayer : undefined;
  const elements = layerElements(runs, editor, interaction, onInteractionChange);
  const palette = useComponentInsert({
    frames: shownFrames,
    selectedFrameIds,
    elements,
    presence,
    onEditLayer: layerEdits,
  });
  const [sideTab, setSideTab] = useState<SidePanelTab>('layers');
  /** Opens the side panel on `tab`, or closes it when it already shows that tab. */
  const showSide = (tab: SidePanelTab) => {
    if (layersOpen && sideTab === tab) {
      onShowLayers(false);
      return;
    }
    setSideTab(tab);
    onShowLayers(true);
  };
  /** The keyboard goes back to the board: on the frame's label where it has one, else the board itself. */
  const focusBoard = (designId: string | undefined) => {
    if (designId !== undefined && isShown(designId)) {
      boardRef.current?.focusLabel(designId);
      return;
    }
    // An empty canvas has no board: its invitation's first action takes the keyboard.
    const board = boardArea.current?.querySelector<HTMLElement>('[data-board-mode]');
    (board ?? boardArea.current?.querySelector('button'))?.focus();
  };
  useBoardPaste(boardArea, {
    appSessionId,
    canvasId,
    attached: pinnable,
    beside: frames.find((frame) => frame.designId === selectedFrameIds.at(0)),
    focusFrame: (designId) => boardRef.current?.focusFrame(designId),
  });
  const showingDocument = shownDocument !== null;
  // Layers stands beside the board or its invitation; Edit's element panel only beside a board.
  const elementPanelOpen = frames.length > 0 && interaction.mode === 'edit';
  const sideColumns = showingDocument ? 0 : [layersOpen, elementPanelOpen].filter(Boolean).length;
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
      sideColumns,
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
    sideColumns,
  ]);

  if (shownDocument)
    return (
      <DocumentMount
        appSessionId={appSessionId}
        canvasId={canvasId}
        pinnable={pinnable}
        shown={shownDocument}
      />
    );

  return (
    <div
      data-canvas-board
      className="flex min-h-0 flex-1"
      onKeyDown={(event) => {
        // A field takes ⌥1 and ⌥2 as the characters they type.
        const tab = sidePanelKey(event);
        if (!tab || isBoardEditor(event.target)) return;
        event.preventDefault();
        showSide(tab);
      }}
    >
      {layersOpen && (
        <SidePanel
          tab={sideTab}
          onTab={setSideTab}
          onClose={() => {
            focusBoard(selectedFrameIds.at(0));
            onShowLayers(false);
          }}
        >
          {sideTab === 'layers' ? (
            <LayersPanel
              frames={frames}
              selectedFrameIds={selectedFrameIds}
              agentWorking={agentWorking}
              elements={elements}
              onRename={frameActions.actions.canEdit ? frameActions.actions.rename : undefined}
              onSetHidden={frameActions.actions.canEdit ? setFrameHidden : undefined}
              onReorder={frameActions.actions.canEdit ? reorderFrames : undefined}
              onEditLayer={layerEdits}
              onHistory={stepHistory}
              onPick={(designId, additive) => {
                // A hidden frame is off the board, so it cannot be picked or gone to.
                if (!isShown(designId)) return;
                const next = reduceBoardInteraction(interaction, {
                  type: 'pick',
                  designId,
                  additive,
                });
                if (next !== interaction) onInteractionChange(next);
              }}
              onFocusFrame={(designId) => {
                if (isShown(designId)) boardRef.current?.focusFrame(designId);
              }}
              onLeave={focusBoard}
              onClose={() => {
                // The panel hands the keyboard to its row's frame; an empty canvas has none.
                if (frames.length === 0) focusBoard(undefined);
                onShowLayers(false);
              }}
            />
          ) : (
            <ComponentsPanel
              kit={palette.kit}
              chatId={pinnable ? appSessionId : null}
              place={palette.place}
              onAdd={palette.add}
              onLeave={() => {
                focusBoard(selectedFrameIds.at(0) ?? editor.selection?.draft.element.designId);
              }}
            />
          )}
        </SidePanel>
      )}
      <div ref={boardArea} className="min-h-0 min-w-0 flex-1">
        {snapshot.frames.length === 0 ? (
          toolsMissing ? (
            <CanvasToolsMissing canvasId={canvasId} />
          ) : (
            <CanvasInvitation />
          )
        ) : (
          <CanvasBoard
            ref={boardRef}
            layers={{
              open: layersOpen && sideTab === 'layers',
              onToggle: () => {
                showSide('layers');
              },
            }}
            snapshot={snapshot}
            restoredViewport={restoredViewport}
            onLeave={onLeaveBoard}
            onOpenSource={onOpenSource}
            onArrangeFrames={arrangeFrames}
            onAnnotate={annotate}
            runs={runs}
            editor={editor}
            onRemoveFrames={removeFrames}
            onHistory={stepHistory}
            interaction={interaction}
            onInteractionChange={onInteractionChange}
            presence={presence}
            writes={writes}
            readSource={readSource}
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
            renderPreview={renderPreview}
          />
        )}
      </div>
      {frameActions.dialog}
    </div>
  );
}

/** A design system document in the pane; `canvasId` is null in a chat without a canvas. */
export function DocumentMount({
  appSessionId,
  canvasId,
  pinnable,
  shown,
}: {
  appSessionId: string;
  canvasId: string | null;
  /** Its catalog can tag entries in the chat's next prompt, as on the chat's own canvas. */
  pinnable: boolean;
  shown: ShownDocument;
}) {
  const dispatch = useStoreDispatch();
  return (
    <div className="min-h-0 flex-1">
      <Suspense fallback={null}>
        <TaggingChat value={pinnable ? appSessionId : null}>
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
        </TaggingChat>
      </Suspense>
    </div>
  );
}
