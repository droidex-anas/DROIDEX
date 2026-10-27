import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Toaster from '../../../src/components/Toaster';
import type {
  Annotation,
  AnnotateCanvasInput,
} from '../../../src/features/canvas/annotationProtocol';
import { applyCanvasChange } from '../../../src/features/canvas/applyCanvasChange';
import { CanvasBoard, type CanvasBoardHandle } from '../../../src/features/canvas/CanvasBoard';
import { SELECT_MODE, type BoardInteraction } from '../../../src/features/canvas/canvasState';
import { CanvasRequestError } from '../../../src/features/canvas/client';
import { DesignPreview } from '../../../src/features/canvas/DesignPreview';
import { FrameRemovals } from '../../../src/features/canvas/frameRemovals';
import type { FrameActions } from '../../../src/features/canvas/FrameToolbar';
import type {
  EditElementInput,
  ElementEditResult,
} from '../../../src/features/canvas/elementEditProtocol';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasFrame,
  CanvasSnapshot,
  FrameRect,
  RemoveFramesInput,
  RenameFrameInput,
  RestoreRevisionInput,
  RevisionSummary,
  SourceElement,
  UndoRemovalInput,
} from '../../../src/features/canvas/protocol';
import { applyTheme, BUILT_IN_THEMES } from '../../../src/lib/theme';
import '../../../src/index.css';
// The harness mounts the board without the pane that normally brings these in.
import '../../../src/features/canvas/canvasAnimations.css';
import '../../../src/features/canvas/canvasBoard.css';
import '../../../src/features/canvas/canvasBoardTools.css';

interface BoardHarness {
  calls: ArrangeFramesInput[];
  annotateCalls: AnnotateCanvasInput[];
  /** Saves one annotate the way the sidecar does and reports it on the feed. */
  answerAnnotate: (index: number) => void;
  refuseAnnotate: (index: number) => void;
  publish: (designId: string, rect: FrameRect, layoutVersion: number) => void;
  reject: (index: number) => void;
  resolve: (index: number) => void;
  focusFrame: (frameId: string) => void;
  select: (designIds: string[]) => void;
  interaction: () => BoardInteraction;
  previewClicks: string[];
  buildReady: () => void;
  /** A frame joins the open board, the way an agent's create lands. */
  arrive: () => void;
  /** The pane narrows or widens around the board. */
  resize: (width: number) => void;
  /** Closes the source drawer the way the workspace does, focus included. */
  closeSource: () => void;
  editCalls: EditElementInput[];
  /** Answers one edit with the revision it wrote, and builds that revision. */
  answerEdit: (index: number, resolution: ElementEditResult['resolution']) => void;
  refuseEdit: (index: number) => void;
  removeCalls: RemoveFramesInput[];
  /** Removes one delete's frames the way the sidecar does, answering `undo_<index>`. */
  answerRemove: (index: number) => void;
  undoCalls: UndoRemovalInput[];
  /** Puts the frames that Undo names back. */
  answerUndo: (index: number) => void;
  /** Refuses one Undo because another frame now sits there. */
  refuseUndo: (index: number) => void;
  /** The designs whose history the toolbar read, in order. */
  historyReads: string[];
  /** Answers one history read with two revisions: `rev_01` on `rev_00`. */
  answerHistory: (index: number) => void;
  renameCalls: RenameFrameInput[];
  /** Renames the frame the way the sidecar does, and answers. */
  answerRename: (index: number) => void;
  restoreCalls: RestoreRevisionInput[];
  /** Refuses one Restore because the frame's head moved. */
  refuseRestore: (index: number) => void;
  /** The toolbar's dialogs asked for, as `<kind>:<designId>`. */
  dialogs: string[];
}

declare global {
  interface Window {
    boardHarness: BoardHarness;
  }
}

const params = new URLSearchParams(location.search);
const scheme = params.get('scheme') === 'light' ? 'light' : 'dark';
applyTheme({
  ...BUILT_IN_THEMES[0][scheme],
  diffStyle: 'soft',
  uiFont: 'system',
  uiFontSize: Number(params.get('font') ?? 14),
  codeFontSize: 13,
  translucentSidebar: false,
  contrast: 100,
});

// Two frames by default, which is what the geometry cases are measured against.
// `?frames=n` adds more in a row below them for the preview-slot budget.
const PLACED: { designId: string; name: string; rect: FrameRect }[] = [
  { designId: 'a', name: 'Design A', rect: { x: 100, y: 50, width: 400, height: 300 } },
  { designId: 'b', name: 'Design B', rect: { x: 650, y: 300, width: 400, height: 300 } },
];
const extra = Math.max(0, Number(params.get('frames') ?? 2) - PLACED.length);
for (let index = 0; index < extra; index += 1) {
  PLACED.push({
    designId: `x${String(index)}`,
    name: `Design X${String(index)}`,
    rect: { x: 100 + index * 450, y: 700, width: 400, height: 300 },
  });
}

const stamp = { createdAt: 1, updatedAt: 1 };
// `?marks=1` opens on a board a user and an agent have already drawn on.
const SEEDED: Annotation[] = [
  {
    id: 'agent-box',
    color: 'red',
    kind: 'rect',
    rect: { x: 90, y: 40, width: 420, height: 320 },
    author: { kind: 'agent', chatId: 'chat_1' },
    ...stamp,
  },
  {
    id: 'arrow',
    color: 'blue',
    kind: 'line',
    points: [
      { x: 520, y: 200 },
      { x: 640, y: 380 },
    ],
    arrowStart: false,
    arrowEnd: true,
    author: { kind: 'user' },
    ...stamp,
  },
  {
    id: 'note',
    color: 'yellow',
    kind: 'note',
    rect: { x: 650, y: 80, width: 260, height: 150 },
    text: 'Tighten the header spacing and try the warmer accent here.',
    author: { kind: 'user' },
    ...stamp,
  },
  {
    id: 'label',
    color: 'green',
    kind: 'text',
    rect: { x: 120, y: 380, width: 240, height: 34 },
    text: 'Keep this layout',
    author: { kind: 'agent', chatId: 'chat_1' },
    ...stamp,
  },
  {
    id: 'scribble',
    color: 'violet',
    kind: 'path',
    points: [
      { x: 700, y: 640 },
      { x: 760, y: 620 },
      { x: 830, y: 650 },
      { x: 900, y: 625 },
      { x: 960, y: 655 },
    ],
    author: { kind: 'user' },
    ...stamp,
  },
];
const seeded = params.has('marks') ? SEEDED : [];
// `?edit=1` maps Design A's source to two elements Edit can pick.
const ELEMENTS: SourceElement[] = params.has('edit')
  ? [
      {
        elementId: 'el_title',
        file: 'main.tsx',
        start: 40,
        end: 90,
        tagName: 'h1',
        editability: 'literal',
      },
      {
        elementId: 'el_card',
        file: 'main.tsx',
        start: 10,
        end: 200,
        tagName: 'section',
        editability: 'shared',
      },
    ]
  : [];

function built(revisionId: string): CanvasFrame['build'] {
  return {
    status: 'ready',
    generation: 1,
    revisionId,
    artifactId: 'a'.repeat(64),
    elements: ELEMENTS,
    diagnostics: [],
  };
}

const initial: CanvasSnapshot = {
  canvasId: 'cv_board',
  sequence: 1,
  annotationsVersion: seeded.length,
  annotations: seeded,
  frames: PLACED.map(
    (frame): CanvasFrame => ({
      ...frame,
      layoutVersion: 3,
      manifestVersion: 1,
      revisionId: 'rev_01',
      designSystem: { id: 'droidex', version: 1, mode: scheme },
      build: params.has('building') ? { status: 'building', generation: 1 } : built('rev_01'),
    }),
  ),
};
const replies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const calls: ArrangeFramesInput[] = [];
const annotateCalls: AnnotateCanvasInput[] = [];
const annotateReplies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const previewClicks: string[] = [];
const editCalls: EditElementInput[] = [];
const editReplies: {
  resolve: (result: ElementEditResult) => void;
  reject: (error: Error) => void;
}[] = [];
const removeCalls: RemoveFramesInput[] = [];
const removeReplies: PromiseWithResolvers<string>[] = [];
const undoCalls: UndoRemovalInput[] = [];
const undoReplies: PromiseWithResolvers<CanvasChange>[] = [];
const removedFrames = new Map<string, CanvasFrame[]>();
const removals = new FrameRemovals({
  removeFrames: (_appSessionId, _canvasId, input) => {
    removeCalls.push(input);
    const reply = Promise.withResolvers<string>();
    removeReplies.push(reply);
    return reply.promise;
  },
  undoRemoval: (_appSessionId, _canvasId, input) => {
    undoCalls.push(input);
    const reply = Promise.withResolvers<CanvasChange>();
    undoReplies.push(reply);
    return reply.promise;
  },
});
const historyReads: string[] = [];
const historyReplies: PromiseWithResolvers<RevisionSummary[]>[] = [];
const renameCalls: RenameFrameInput[] = [];
const renameReplies: PromiseWithResolvers<void>[] = [];
const restoreCalls: RestoreRevisionInput[] = [];
const restoreReplies: PromiseWithResolvers<void>[] = [];
const dialogs: string[] = [];
const frameActions: FrameActions = {
  history: {
    listRevisions: (designId) => {
      historyReads.push(designId);
      const reply = Promise.withResolvers<RevisionSummary[]>();
      historyReplies.push(reply);
      return reply.promise;
    },
    restoreRevision: (input) => {
      restoreCalls.push(input);
      const reply = Promise.withResolvers<void>();
      restoreReplies.push(reply);
      return reply.promise;
    },
  },
  canEdit: true,
  rename: (frame, name) => {
    renameCalls.push({
      mutationId: 'rename',
      designId: frame.designId,
      name,
      expectedManifestVersion: frame.manifestVersion,
    });
    const reply = Promise.withResolvers<void>();
    renameReplies.push(reply);
    return reply.promise;
  },
  makeVariants: (frame) => dialogs.push(`variants:${frame.designId}`),
  saveToLibrary: (frame) => dialogs.push(`save:${frame.designId}`),
};

function revision(revisionId: string, sequence: number, author: 'user' | 'agent'): RevisionSummary {
  return {
    revisionId,
    sequence,
    author: author === 'user' ? { kind: 'user' } : { kind: 'agent', scopeRef: 'chat_1' },
    mutationKind: sequence === 1 ? 'create' : 'edit',
    state: 'saved',
    createdAt: Date.now() - (3 - sequence) * 3_600_000,
    designSystem: { id: 'droidex', version: 1, mode: scheme },
    buildStatus: 'ready',
  };
}

const readArtifact = () => Promise.resolve({ artifactId: 'a'.repeat(64), html: '<p>Ready</p>' });

function Harness() {
  const [snapshot, setSnapshot] = useState(initial);
  const [interaction, setInteraction] = useState(SELECT_MODE);
  const [width, setWidth] = useState(1000);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const board = useRef<CanvasBoardHandle>(null);
  const live = useRef(interaction);
  live.current = interaction;
  const shown = useRef(snapshot);
  shown.current = snapshot;
  const change = (frames: CanvasFrame[], removedDesignIds: string[]): CanvasChange => ({
    canvasId: shown.current.canvasId,
    sequence: shown.current.sequence + 1,
    frames,
    removedDesignIds,
  });
  window.boardHarness = {
    calls,
    annotateCalls,
    answerAnnotate: (index) => {
      const { upserts, deletes } = annotateCalls[index];
      setSnapshot((current) =>
        applyCanvasChange(current, {
          canvasId: current.canvasId,
          sequence: current.sequence + 1,
          frames: [],
          removedDesignIds: [],
          annotations: {
            version: current.annotationsVersion + 1,
            upserted: upserts.map((draft) => ({ ...draft, author: { kind: 'user' }, ...stamp })),
            removedIds: deletes,
          },
        }),
      );
      annotateReplies[index].resolve();
    },
    refuseAnnotate: (index) =>
      annotateReplies[index].reject(
        new CanvasRequestError('revision_conflict', 'Annotations changed'),
      ),
    publish: (designId, rect, layoutVersion) => {
      setSnapshot((current) => ({
        ...current,
        sequence: current.sequence + 1,
        frames: current.frames.map((frame) =>
          frame.designId === designId ? { ...frame, rect, layoutVersion } : frame,
        ),
      }));
    },
    reject: (index) => replies[index].reject(new Error('Arrange rejected')),
    resolve: (index) => replies[index].resolve(),
    focusFrame: (frameId) => {
      if (!board.current) throw new Error('Missing board focus handle');
      board.current.focusFrame(frameId);
    },
    select: (designIds) => {
      setInteraction({ mode: 'select', selectedFrameIds: designIds, interactedFrameId: null });
    },
    interaction: () => live.current,
    previewClicks,
    resize: setWidth,
    closeSource: () => {
      const opener = sourceOpen;
      setSourceOpen(null);
      if (opener) requestAnimationFrame(() => board.current?.focusLabel(opener));
    },
    arrive: () => {
      setSnapshot((current) => ({
        ...current,
        sequence: current.sequence + 1,
        frames: [
          ...current.frames,
          {
            ...current.frames[0],
            designId: 'arrived',
            name: 'Design Arrived',
            rect: { x: 100, y: 650, width: 400, height: 300 },
          },
        ],
      }));
    },
    buildReady: () =>
      setSnapshot((current) => ({
        ...current,
        frames: current.frames.map((frame) => ({ ...frame, build: built('rev_01') })),
      })),
    editCalls,
    answerEdit: (index, resolution) => {
      const { designId } = editCalls[index].edit.element;
      const revisionId = `rev_0${String(index + 2)}`;
      editReplies[index].resolve({
        receipt: { designId, revisionId, sequence: index + 2 },
        resolution,
      });
      setSnapshot((current) => ({
        ...current,
        sequence: current.sequence + 1,
        frames: current.frames.map((frame) =>
          frame.designId === designId ? { ...frame, revisionId, build: built(revisionId) } : frame,
        ),
      }));
    },
    refuseEdit: (index) =>
      editReplies[index].reject(
        new CanvasRequestError('stale_reference', 'This element changed. Pick it again.'),
      ),
    removeCalls,
    answerRemove: (index) => {
      const { designIds } = removeCalls[index];
      const undoId = `undo_${String(index)}`;
      removedFrames.set(
        undoId,
        shown.current.frames.filter((frame) => designIds.includes(frame.designId)),
      );
      setSnapshot(applyCanvasChange(shown.current, change([], designIds)));
      removeReplies[index].resolve(undoId);
    },
    undoCalls,
    answerUndo: (index) => {
      const restored = change(removedFrames.get(undoCalls[index].undoId) ?? [], []);
      setSnapshot(applyCanvasChange(shown.current, restored));
      undoReplies[index].resolve(restored);
    },
    refuseUndo: (index) =>
      undoReplies[index].reject(
        new CanvasRequestError('layout_conflict', 'Another frame now occupies that location.'),
      ),
    historyReads,
    answerHistory: (index) =>
      historyReplies[index].resolve([
        revision('rev_01', 2, 'user'),
        revision('rev_00', 1, 'agent'),
      ]),
    renameCalls,
    answerRename: (index) => {
      const { designId, name } = renameCalls[index];
      const renamed = shown.current.frames
        .filter((frame) => frame.designId === designId)
        .map((frame) => ({ ...frame, name, manifestVersion: frame.manifestVersion + 1 }));
      setSnapshot(applyCanvasChange(shown.current, change(renamed, [])));
      renameReplies[index].resolve();
    },
    restoreCalls,
    refuseRestore: (index) =>
      restoreReplies[index].reject(new CanvasRequestError('revision_conflict', 'The head moved.')),
    dialogs,
  };
  return (
    <div style={{ padding: 24 }}>
      <button type="button" id="outside" aria-pressed={interaction.selectedFrameIds.length > 0}>
        Outside board
      </button>
      <div style={{ display: 'flex', width, height: 800, marginTop: 12 }}>
        <CanvasBoard
          ref={board}
          snapshot={snapshot}
          interaction={interaction}
          agentWorking={false}
          onInteractionChange={setInteraction}
          renderPreview={(frame, revisionId, selections) =>
            params.get('preview') === 'guest' ? (
              <DesignPreview
                canvasId={snapshot.canvasId}
                frame={frame}
                revisionId={revisionId}
                readArtifact={readArtifact}
                reportPreview={() => undefined}
                selections={selections}
              />
            ) : (
              <button
                type="button"
                data-harness-preview={frame.designId}
                onPointerDown={() => previewClicks.push(frame.designId)}
                style={{ width: '100%', height: '100%' }}
              >
                {frame.name} preview
              </button>
            )
          }
          onArrangeFrames={(input) => {
            calls.push(input);
            return new Promise<void>((resolve, reject) => replies.push({ resolve, reject }));
          }}
          onAnnotate={(input) => {
            annotateCalls.push(input);
            return new Promise<void>((resolve, reject) =>
              annotateReplies.push({ resolve, reject }),
            );
          }}
          onEditElement={(input) => {
            editCalls.push(input);
            return new Promise<ElementEditResult>((resolve, reject) =>
              editReplies.push({ resolve, reject }),
            );
          }}
          onOpenSource={setSourceOpen}
          onRemoveFrames={(frames) => removals.remove('chat_1', snapshot.canvasId, frames)}
          onUndoRemoval={() => removals.undoLatest(snapshot.canvasId)}
          frameActions={frameActions}
        />
        {sourceOpen && (
          <aside data-harness-source={sourceOpen} style={{ width: 280, flexShrink: 0 }}>
            Source of {sourceOpen}
          </aside>
        )}
      </div>
      <Toaster />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing harness root');
createRoot(root).render(<Harness />);
