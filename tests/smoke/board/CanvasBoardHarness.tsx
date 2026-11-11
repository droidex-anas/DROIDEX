import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Toaster from '../../../src/components/ui/Toaster';
import type {
  Annotation,
  AnnotateCanvasInput,
} from '../../../src/features/canvas/annotationProtocol';
import { applyCanvasChange } from '../../../src/features/canvas/applyCanvasChange';
import { BoardHistory, recordPlacements } from '../../../src/features/canvas/boardHistory';
import { showBoard } from '../../../src/features/canvas/boardOnScreen';
import { CanvasColumnTabs } from '../../../src/features/canvas/CanvasColumnTabs';
import { CanvasBoard, type CanvasBoardHandle } from '../../../src/features/canvas/CanvasBoard';
import {
  NO_LANDED_WRITES,
  NO_PRESENCE,
  type CanvasPresence,
  type LandedWrites,
} from '../../../src/features/canvas/canvasPresence';
import {
  picksElements,
  reduceBoardInteraction,
  SELECT_MODE,
  type BoardInteraction,
} from '../../../src/features/canvas/canvasState';
import { isBoardEditor, isLayersKey } from '../../../src/features/canvas/boardKeys';
import { canvasMessage, CanvasRequestError } from '../../../src/features/canvas/client';
import { DesignPreview } from '../../../src/features/canvas/DesignPreview';
import { ExportToProjectDialog } from '../../../src/features/canvas/ExportToProjectDialog';
import {
  syncFramePins,
  toggleFramePins,
  useFramePins,
} from '../../../src/features/canvas/framePins';
import { FrameRemovals } from '../../../src/features/canvas/frameRemovals';
import { layerElements } from '../../../src/features/canvas/layers/layerElements';
import { LayersPanel } from '../../../src/features/canvas/layers/LayersPanel';
import { PreviewRuns } from '../../../src/features/canvas/previewRuns';
import { useElementEditor } from '../../../src/features/canvas/useElementEditor';
import type { FrameActions } from '../../../src/features/canvas/FrameToolbar';
import {
  elementVariantPrompt,
  type VariantChoice,
} from '../../../src/features/canvas/variantRequests';
import { variantSetSource, VariantSets } from '../../../src/features/canvas/variantSets';
import type {
  EditElementInput,
  ElementEdited,
} from '../../../src/features/canvas/elementEditProtocol';
import {
  elementPins,
  pickElement,
  syncElementPins,
  unpinElements,
  useElementPins,
} from '../../../src/features/canvas/elementPins';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasFrame,
  CanvasSnapshot,
  FrameRect,
  RemoveFramesInput,
  RenameFrameInput,
  SwitchRevisionInput,
  RevisionSummary,
  SourceElement,
  SourceOutline,
  UndoRemovalInput,
  WriteFilesInput,
  WriteReceipt,
} from '../../../src/features/canvas/protocol';
import { applyTheme, BUILT_IN_THEMES } from '../../../src/lib/theme';
import { subscribeToasts, toast, type ToastItem } from '../../../src/lib/toast';
import '../../../src/index.css';
// The harness mounts the board without the pane that normally brings these in.
import '../../../src/features/canvas/canvasAnimations.css';
import '../../../src/features/canvas/canvasBoard.css';
import '../../../src/features/canvas/canvasBoardSelection.css';
import '../../../src/features/canvas/canvasBoardTools.css';
import '../../../src/features/canvas/canvasPresence.css';

interface BoardHarness {
  calls: ArrangeFramesInput[];
  annotateCalls: AnnotateCanvasInput[];
  /** Saves one annotate the way the sidecar does and reports it on the feed. */
  answerAnnotate: (index: number) => void;
  refuseAnnotate: (index: number) => void;
  publish: (designId: string, rect: FrameRect, layoutVersion: number) => void;
  reject: (index: number) => void;
  resolve: (index: number) => void;
  /** Places one arrange's frames the way the sidecar does, and answers. */
  answer: (index: number) => void;
  focusFrame: (frameId: string) => void;
  select: (designIds: string[]) => void;
  interaction: () => BoardInteraction;
  previewClicks: string[];
  buildReady: () => void;
  /** The agents at work finish: their frames' designs land and they leave. */
  finishWork: () => void;
  /**
   * The write of the agent on a frame lands as `rev_landed`, built, rewriting
   * the title `?edit=1` maps, and its result names that revision.
   */
  landWrite: (designId: string) => void;
  /** The user's own edit lands as `rev_landed`, the same source, with no agent's result. */
  editByUser: (designId: string) => void;
  /** Source reads wait until released; releasing answers them and says how many there were. */
  holdSourceReads: () => void;
  releaseSourceReads: () => number;
  /** A frame leaves the board, and comes back as it was. */
  takeOff: (designId: string) => void;
  putBack: (designId: string) => void;
  /** The agents' calls end and they leave, their frames as they are. */
  leave: () => void;
  /** The agents start new calls on the frames they opened on. */
  returnToWork: () => void;
  /** A frame joins the open board, the way an agent's create lands. */
  arrive: (designId?: string, rect?: FrameRect) => void;
  /** The pane narrows or widens around the board. */
  resize: (width: number) => void;
  /** Closes the source drawer the way the workspace does, focus included. */
  closeSource: () => void;
  editCalls: EditElementInput[];
  /** What Design's quick prompt handed the chat's composer. */
  seeds: { text: string; send: boolean }[];
  /**
   * Answers one edit with the revision it wrote, and builds that revision. A
   * layer's edit lands on `landed`, or else on its own row.
   */
  /** `landed` names the row the edit lands on; null for none, omitted for its own. */
  answerEdit: (index: number, landed?: string | null) => void;
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
  /** Layers' hides and shows, each answered as it is asked. */
  hideCalls: { designId: string; hidden: boolean }[];
  /** Layers' restacks, back to front, each answered as it is asked. */
  reorderCalls: string[][];
  /** A manifest commit lands on the frame: a build's, or with `name`, a rename from elsewhere. */
  commitManifest: (designId: string, name?: string) => void;
  switchCalls: SwitchRevisionInput[];
  /** Moves the frame's head to the revision one switch names, built, and answers. */
  answerSwitch: (index: number) => void;
  /** Refuses one switch because the frame's head moved. */
  refuseSwitch: (index: number) => void;
  /** The toolbar's dialogs asked for, as `<kind>:<designId>`. */
  dialogs: string[];
  variantCalls: (VariantChoice & { designId: string })[];
  /** The words of each request for variants of picked elements. */
  elementVariantRequests: string[];
  /** Settles one variants request, as its send does. */
  answerVariants: (index: number) => void;
  writeCalls: WriteFilesInput[];
  /** Writes one source the way the sidecar does, as revision `rev_w<index>`, and builds it. */
  answerWrite: (index: number) => void;
  /** The messages of the toasts up now; one that ended is gone even while it fades. */
  toasts: () => string[];
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

// `?inset=n` docks a stand-in panel n pixels wide over the board's right edge.
const RIGHT_INSET = Number(params.get('inset') ?? 0);

// Two frames by default, which is what the geometry cases are measured against.
// `?frames=n` adds more in a row below them for the preview-slot budget.
// `?navigator=1` puts the chat column's Components tab beside the board.
// `?layers=1` gives the board its Layers tool, with the panel open at its left.
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
// `?edit=1` maps Design A's source to two elements Edit can pick, in the
// build's order: by file, then by start.
const ELEMENTS: SourceElement[] = params.has('edit')
  ? [
      {
        elementId: 'el_card',
        file: 'main.tsx',
        start: 10,
        end: 200,
        line: 2,
        tagName: 'section',
        component: 'Card',
        editability: 'shared',
      },
      {
        elementId: 'el_title',
        file: 'main.tsx',
        start: 40,
        end: 90,
        line: 3,
        tagName: 'h1',
        component: 'Card',
        editability: 'literal',
      },
    ]
  : [];
// Its source outline: an instance of Card, which renders the section holding the title.
const OUTLINE: SourceOutline = {
  nodes: params.has('edit')
    ? [
        {
          nodeId: '0000000000000001',
          parentId: null,
          kind: 'instance',
          name: 'Card',
          text: null,
          elementId: null,
          lock: null,
          free: false,
          contentFromProps: false,
          visibility: 'shown',
        },
        {
          nodeId: '0000000000000002',
          parentId: '0000000000000001',
          kind: 'element',
          name: 'section',
          text: null,
          elementId: 'el_card',
          lock: 'shared',
          free: false,
          contentFromProps: false,
          visibility: 'shown',
        },
        {
          nodeId: '0000000000000003',
          parentId: '0000000000000002',
          kind: 'element',
          name: 'h1',
          text: 'Pricing',
          elementId: 'el_title',
          lock: null,
          free: true,
          contentFromProps: false,
          visibility: 'shown',
        },
      ]
    : [],
  truncated: false,
};

// `?moves=1` writes a page whose layers move: main holding a title, a line, a hidden section and
// an image whose own classes decide its display.
const movable = (nodeId: string, parentId: string | null, name: string, text: string | null) => ({
  nodeId,
  parentId,
  kind: 'element' as const,
  name,
  text,
  elementId: `el_${nodeId}`,
  lock: null,
  free: parentId !== null,
  contentFromProps: false,
  visibility: 'shown' as const,
});
const MOVES: SourceOutline = {
  nodes: [
    movable('main', null, 'main', null),
    movable('title', 'main', 'h1', 'Pricing'),
    movable('line', 'main', 'p', 'Start free'),
    { ...movable('section', 'main', 'section', null), visibility: 'hidden' as const },
    { ...movable('image', 'main', 'img', null), visibility: 'display' as const },
  ],
  truncated: false,
};

function built(revisionId: string): CanvasFrame['build'] {
  return {
    status: 'ready',
    generation: 1,
    revisionId,
    artifactId: 'a'.repeat(64),
    elements: ELEMENTS,
    outline: params.has('moves') ? MOVES : OUTLINE,
    diagnostics: [],
  };
}

// `?presence=1` opens with two agents at work: Kairo on Design A, which has no
// design yet, and Lyra rewriting Design B.
const working = params.has('presence');
const PRESENCE: CanvasPresence = working
  ? new Map([
      ['a', { agent: { key: 'chat_1', name: 'Kairo', color: 'crimson' }, named: false }],
      ['b', { agent: { key: 'chat_1/worker_1', name: 'Lyra', color: 'green' }, named: true }],
    ])
  : NO_PRESENCE;

const initial: CanvasSnapshot = {
  canvasId: 'cv_board',
  sequence: 1,
  annotationsVersion: seeded.length,
  annotations: seeded,
  frames: PLACED.map((frame): CanvasFrame => {
    // `?variants=1` makes Design B a variant of Design A that its agent has since changed.
    const isVariant = params.has('variants') && frame.designId === 'b';
    const placed: CanvasFrame = {
      ...frame,
      layoutVersion: 3,
      manifestVersion: 1,
      revisionId: 'rev_01',
      designSystem: { id: 'droidex', version: 1, mode: scheme },
      variantOf: isVariant ? 'a' : null,
      seededRevisionId: isVariant ? 'rev_00' : null,
      hidden: false,
      build: params.has('building') ? { status: 'building', generation: 1 } : built('rev_01'),
    };
    if (!working || frame.designId !== 'a') return placed;
    return { ...placed, revisionId: null, build: { status: 'pending', generation: 0 } };
  }),
};
const replies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const calls: ArrangeFramesInput[] = [];
const annotateCalls: AnnotateCanvasInput[] = [];
const annotateReplies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const previewClicks: string[] = [];
const editCalls: EditElementInput[] = [];
const seeds: { text: string; send: boolean }[] = [];
const editReplies: {
  resolve: (edited: ElementEdited) => void;
  reject: (error: Error) => void;
}[] = [];
const removeCalls: RemoveFramesInput[] = [];
const removeReplies: PromiseWithResolvers<string>[] = [];
const undoCalls: UndoRemovalInput[] = [];
const undoReplies: PromiseWithResolvers<CanvasChange>[] = [];
const removedFrames = new Map<string, CanvasFrame[]>();
// What the board is showing, which the history reads the way it reads the client's projection.
const shown = { current: initial };
const history = new BoardHistory();
const arrangeFrames = recordPlacements(
  history,
  initial.canvasId,
  (input: ArrangeFramesInput) => {
    calls.push(input);
    return new Promise<void>((resolve, reject) => replies.push({ resolve, reject }));
  },
  () => shown.current.frames,
);
const removals = new FrameRemovals(
  {
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
  },
  history,
);
const historyReads: string[] = [];
const historyReplies: PromiseWithResolvers<RevisionSummary[]>[] = [];
const renameCalls: RenameFrameInput[] = [];
const hideCalls: BoardHarness['hideCalls'] = [];
const reorderCalls: string[][] = [];
const renameReplies: PromiseWithResolvers<void>[] = [];
const switchCalls: SwitchRevisionInput[] = [];
const switchReplies: PromiseWithResolvers<WriteReceipt>[] = [];
let toasts: ToastItem[] = [];
subscribeToasts((shown) => {
  toasts = shown;
});
/** Every switch, from the toolbar's versions or the board's history, one reply per call. */
function askSwitch(input: SwitchRevisionInput): Promise<WriteReceipt> {
  switchCalls.push(input);
  const reply = Promise.withResolvers<WriteReceipt>();
  switchReplies.push(reply);
  return reply.promise;
}
const dialogs: string[] = [];
// `?project=1` opens the real Export to project dialog too, on the page's own `window.droidex`.
const projectExport: { open: ((frame: CanvasFrame) => void) | null } = { open: null };
const variantCalls: BoardHarness['variantCalls'] = [];
const elementVariantRequests: string[] = [];
const variantReplies: PromiseWithResolvers<void>[] = [];
const writeCalls: WriteFilesInput[] = [];
const writeReplies: PromiseWithResolvers<WriteReceipt>[] = [];
const variantSets = new VariantSets(
  {
    source: {
      read: (_canvasId, designId) => Promise.resolve({ 'main.tsx': `// ${designId}` }),
      write: (_appSessionId, _canvasId, input) => {
        writeCalls.push(input);
        const reply = Promise.withResolvers<WriteReceipt>();
        writeReplies.push(reply);
        return reply.promise;
      },
    },
    revisions: { switchTo: (_appSessionId, _canvasId, input) => askSwitch(input) },
    snapshotOf: () => shown.current,
  },
  history,
  removals,
);
const frameActions: FrameActions = {
  history: {
    listRevisions: (designId) => {
      historyReads.push(designId);
      const reply = Promise.withResolvers<RevisionSummary[]>();
      historyReplies.push(reply);
      return reply.promise;
    },
    switchRevision: askSwitch,
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
  picksIn: (frame) =>
    elementPins('chat_1').filter(
      ({ canvasId, element }) =>
        canvasId === 'cv_board' &&
        element.designId === frame.designId &&
        element.revisionId === frame.revisionId,
    ),
  makeVariants: (frame, choice, picks) =>
    variantSets.make('cv_board', frame.designId, () => {
      variantCalls.push({ designId: frame.designId, ...choice });
      if (picks.length > 0)
        elementVariantRequests.push(
          elementVariantPrompt(
            frame.name,
            picks.map((pin) => pin.element),
            choice,
          ),
        );
      const reply = Promise.withResolvers<void>();
      variantReplies.push(reply);
      return reply.promise;
    }),
  variantWork: variantSets.viewOf('cv_board'),
  sourceOf: (frame) => variantSetSource(shown.current.frames, frame),
  applyVariant: (variant, source) => variantSets.apply('chat_1', 'cv_board', variant, source),
  saveToLibrary: (frame) => dialogs.push(`save:${frame.designId}`),
  exportImage: (frame) => dialogs.push(`export:${frame.designId}`),
  exportToProject: (frame) => {
    dialogs.push(`project:${frame.designId}`);
    projectExport.open?.(frame);
  },
};

function revision(revisionId: string, sequence: number, author: 'user' | 'agent'): RevisionSummary {
  return {
    revisionId,
    version: sequence,
    sequence,
    author: author === 'user' ? { kind: 'user' } : { kind: 'agent', scopeRef: 'chat_1' },
    mutationKind: sequence === 1 ? 'create' : 'edit',
    state: 'saved',
    createdAt: Date.now() - (3 - sequence) * 3_600_000,
    designSystem: { id: 'droidex', version: 1, mode: scheme },
    buildStatus: 'ready',
  };
}

// A landed write's revision has an artifact of its own, so its preview mounts afresh.
const readArtifact = (_canvasId: string, _designId: string, revisionId: string) =>
  Promise.resolve({
    artifactId: (revisionId === 'rev_landed' ? 'b' : 'a').repeat(64),
    html: '<p>Ready</p>',
  });

// Every revision's source is the same but `rev_landed`'s, whose title (40 to 90) is new.
const SOURCE = '-'.repeat(200);
const sourceReads: { held: boolean; waiting: (() => void)[] } = { held: false, waiting: [] };
const readSource = (_designId: string, revisionId: string) => {
  const files = {
    'main.tsx':
      revisionId === 'rev_landed'
        ? `${SOURCE.slice(0, 40)}${'T'.repeat(50)}${SOURCE.slice(90)}`
        : SOURCE,
  };
  if (!sourceReads.held) return Promise.resolve(files);
  return new Promise<typeof files>((resolve) => sourceReads.waiting.push(() => resolve(files)));
};
const takenOff = new Map<string, CanvasFrame>();

function Harness() {
  const [snapshot, setSnapshot] = useState(initial);
  const [presence, setPresence] = useState(PRESENCE);
  const [writes, setWrites] = useState<LandedWrites>(NO_LANDED_WRITES);
  const [interaction, setInteraction] = useState(SELECT_MODE);
  const [width, setWidth] = useState(1000);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState<CanvasFrame | null>(null);
  const [layersOpen, setLayersOpen] = useState(params.has('layers'));
  const [runs] = useState(() => new PreviewRuns());
  const shownFrames = useMemo(() => snapshot.frames.filter(({ hidden }) => !hidden), [snapshot]);
  const editor = useElementEditor({
    canvasId: snapshot.canvasId,
    frames: shownFrames,
    runs,
    active: interaction.mode === 'edit',
    hovering: picksElements(interaction.mode),
    onEditElement: (input) => {
      editCalls.push(input);
      return new Promise<ElementEdited>((resolve, reject) => editReplies.push({ resolve, reject }));
    },
  });
  if (params.has('project')) projectExport.open = setExporting;
  const tagged = useFramePins('chat_1');
  const picks = useElementPins('chat_1');
  const board = useRef<CanvasBoardHandle>(null);
  const live = useRef(interaction);
  live.current = interaction;
  shown.current = snapshot;
  useEffect(() => {
    syncElementPins('chat_1', snapshot);
    return syncFramePins('chat_1', snapshot);
  }, [snapshot]);
  useEffect(() => {
    if (!params.has('navigator')) return undefined;
    return showBoard({
      appSessionId: 'chat_1',
      canvasId: snapshot.canvasId,
      attached: true,
      agentWorking: false,
      frames: snapshot.frames,
      selected: snapshot.frames.filter((frame) =>
        interaction.selectedFrameIds.includes(frame.designId),
      ),
      sideColumns: 0,
      focusFrame: (designId) => board.current?.focusFrame(designId),
    });
  }, [snapshot, interaction]);
  /** A change as the sidecar sends one: the frames without their builds, and the builds of `rebuilt` alone. */
  const change = (
    frames: CanvasFrame[],
    removedDesignIds: string[],
    rebuilt: CanvasFrame[] = [],
  ): CanvasChange => ({
    canvasId: shown.current.canvasId,
    sequence: shown.current.sequence + 1,
    frames: frames.map(({ build: _build, ...fields }) => fields),
    builds: rebuilt.map(({ designId, build }) => ({ designId, build })),
    removedDesignIds,
  });
  const apply = (current: CanvasSnapshot, next: CanvasChange): CanvasSnapshot => {
    const applied = applyCanvasChange(current, next);
    if (!applied)
      throw new Error('The harness sent a frame the board does not hold without its build.');
    return applied;
  };
  window.boardHarness = {
    calls,
    annotateCalls,
    answerAnnotate: (index) => {
      const { upserts, deletes } = annotateCalls[index];
      setSnapshot((current) =>
        apply(current, {
          canvasId: current.canvasId,
          sequence: current.sequence + 1,
          frames: [],
          builds: [],
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
    answer: (index) => {
      const placed = shown.current.frames.flatMap((frame) => {
        const placement = calls[index].frames.find((each) => each.designId === frame.designId);
        if (!placement) return [];
        return [
          { ...frame, rect: placement.rect, layoutVersion: placement.expectedLayoutVersion + 1 },
        ];
      });
      // The client's projection holds the answer before React renders it, and
      // the history reads it as soon as the reply settles.
      shown.current = apply(shown.current, change(placed, []));
      setSnapshot(shown.current);
      replies[index].resolve();
    },
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
    arrive: (designId = 'arrived', rect = { x: 100, y: 650, width: 400, height: 300 }) => {
      setSnapshot((current) => ({
        ...current,
        sequence: current.sequence + 1,
        frames: [
          ...current.frames,
          { ...current.frames[0], designId, name: `Design ${designId}`, rect },
        ],
      }));
    },
    buildReady: () =>
      setSnapshot((current) => ({
        ...current,
        frames: current.frames.map((frame) => ({ ...frame, build: built('rev_01') })),
      })),
    finishWork: () => {
      setSnapshot((current) => ({
        ...current,
        sequence: current.sequence + 1,
        frames: current.frames.map((frame) => ({
          ...frame,
          revisionId: 'rev_01',
          build: built('rev_01'),
        })),
      }));
      setPresence(NO_PRESENCE);
    },
    landWrite: (designId) => {
      window.boardHarness.editByUser(designId);
      const agentKey = PRESENCE.get(designId)?.agent.key;
      if (agentKey) setWrites(new Map([[designId, { agentKey, revisionId: 'rev_landed' }]]));
    },
    editByUser: (designId) => {
      const landed = shown.current.frames
        .filter((frame) => frame.designId === designId)
        .map((frame) => ({ ...frame, revisionId: 'rev_landed', build: built('rev_landed') }));
      setSnapshot(apply(shown.current, change(landed, [], landed)));
    },
    holdSourceReads: () => {
      sourceReads.held = true;
    },
    releaseSourceReads: () => {
      const waiting = sourceReads.waiting.splice(0);
      sourceReads.held = false;
      for (const answer of waiting) answer();
      return waiting.length;
    },
    takeOff: (designId) => {
      const leaving = shown.current.frames.find((frame) => frame.designId === designId);
      if (leaving) takenOff.set(designId, leaving);
      setSnapshot(apply(shown.current, change([], [designId])));
    },
    putBack: (designId) => {
      const returning = takenOff.get(designId);
      if (returning) setSnapshot(apply(shown.current, change([returning], [], [returning])));
    },
    leave: () => {
      setPresence(NO_PRESENCE);
    },
    returnToWork: () => {
      setPresence(PRESENCE);
    },
    editCalls,
    seeds,
    answerEdit: (index, landed) => {
      const { edit } = editCalls[index];
      const { designId } = 'element' in edit ? edit.element : edit.layer;
      const revisionId = `rev_0${String(index + 2)}`;
      // Every revision's outline is the same, so a layer lands on its own row unless told otherwise.
      const ownRow = 'layer' in edit ? edit.layer.nodeId : null;
      editReplies[index].resolve({
        receipt: { designId, revisionId, sequence: index + 2 },
        landed: landed === undefined ? ownRow : landed,
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
      setSnapshot(apply(shown.current, change([], designIds)));
      removeReplies[index].resolve(undoId);
    },
    undoCalls,
    answerUndo: (index) => {
      const frames = removedFrames.get(undoCalls[index].undoId) ?? [];
      const restored = change(frames, [], frames);
      setSnapshot(apply(shown.current, restored));
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
    hideCalls,
    reorderCalls,
    answerRename: (index) => {
      const { designId, name } = renameCalls[index];
      const renamed = shown.current.frames
        .filter((frame) => frame.designId === designId)
        .map((frame) => ({ ...frame, name, manifestVersion: frame.manifestVersion + 1 }));
      setSnapshot(apply(shown.current, change(renamed, [])));
      renameReplies[index].resolve();
    },
    commitManifest: (designId, name) => {
      const committed = shown.current.frames
        .filter((frame) => frame.designId === designId)
        .map((frame) => ({
          ...frame,
          name: name ?? frame.name,
          manifestVersion: frame.manifestVersion + 1,
        }));
      setSnapshot(apply(shown.current, change(committed, [])));
    },
    switchCalls,
    answerSwitch: (index) => {
      const { designId, revisionId } = switchCalls[index];
      const frames = shown.current.frames
        .filter((frame) => frame.designId === designId)
        .map((frame) => ({ ...frame, revisionId, build: built(revisionId) }));
      const switched = change(frames, [], frames);
      setSnapshot(apply(shown.current, switched));
      switchReplies[index].resolve({ designId, revisionId, sequence: switched.sequence });
    },
    refuseSwitch: (index) =>
      switchReplies[index].reject(new CanvasRequestError('revision_conflict', 'The head moved.')),
    dialogs,
    variantCalls,
    elementVariantRequests,
    answerVariants: (index) => {
      variantReplies[index].resolve();
    },
    writeCalls,
    answerWrite: (index) => {
      const { designId } = writeCalls[index];
      const revisionId = `rev_w${String(index)}`;
      const written = shown.current.frames
        .filter((frame) => frame.designId === designId)
        .map((frame) => ({ ...frame, revisionId, build: built(revisionId) }));
      setSnapshot(apply(shown.current, change(written, [], written)));
      writeReplies[index].resolve({ designId, revisionId, sequence: index + 2 });
    },
    toasts: () => toasts.map((shown) => shown.message),
  };
  return (
    <div style={{ padding: 24 }}>
      <button type="button" id="outside" aria-pressed={interaction.selectedFrameIds.length > 0}>
        Outside board
      </button>
      <div
        data-canvas-board
        style={{ position: 'relative', display: 'flex', width, height: 800, marginTop: 12 }}
        onKeyDown={(event) => {
          if (!isLayersKey(event) || isBoardEditor(event.target)) return;
          event.preventDefault();
          setLayersOpen(!layersOpen);
        }}
      >
        {layersOpen && (
          <LayersPanel
            frames={snapshot.frames}
            selectedFrameIds={interaction.selectedFrameIds}
            agentWorking={presence.size > 0}
            elements={layerElements(runs, editor, interaction, setInteraction)}
            onRename={frameActions.rename}
            onSetHidden={(frame, hidden) => {
              hideCalls.push({ designId: frame.designId, hidden });
              setSnapshot(apply(shown.current, change([{ ...frame, hidden }], [])));
            }}
            onReorder={(designIds) => {
              reorderCalls.push(designIds);
              setSnapshot(apply(shown.current, { ...change([], []), order: designIds }));
            }}
            onEditLayer={(layer, change) =>
              editor.editLayer(layer, change).catch((refusal: unknown) => {
                toast.error(canvasMessage(refusal));
                return null;
              })
            }
            onHistory={(step) =>
              step === 'undo' ? history.undo(snapshot.canvasId) : history.redo(snapshot.canvasId)
            }
            onPick={(designId, additive) => {
              setInteraction(
                reduceBoardInteraction(interaction, { type: 'pick', designId, additive }),
              );
            }}
            onFocusFrame={(designId) => board.current?.focusFrame(designId)}
            onLeave={(designId) => board.current?.focusLabel(designId)}
            onClose={() => {
              setLayersOpen(false);
            }}
          />
        )}
        <CanvasBoard
          ref={board}
          layers={
            params.has('layers')
              ? {
                  open: layersOpen,
                  onToggle: () => {
                    setLayersOpen(!layersOpen);
                  },
                }
              : undefined
          }
          rightInset={RIGHT_INSET}
          snapshot={snapshot}
          interaction={interaction}
          presence={presence}
          writes={writes}
          readSource={readSource}
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
          onArrangeFrames={arrangeFrames}
          onAnnotate={(input) => {
            annotateCalls.push(input);
            return new Promise<void>((resolve, reject) =>
              annotateReplies.push({ resolve, reject }),
            );
          }}
          runs={runs}
          editor={editor}
          onOpenSource={setSourceOpen}
          onRemoveFrames={(frames) => removals.remove('chat_1', snapshot.canvasId, frames)}
          onHistory={(step) =>
            step === 'undo' ? history.undo(snapshot.canvasId) : history.redo(snapshot.canvasId)
          }
          pinnedIds={new Set(tagged.map((pin) => pin.designId))}
          onTagFrames={(designIds) => {
            const frames = snapshot.frames.filter((frame) => designIds.includes(frame.designId));
            toggleFramePins('chat_1', snapshot.canvasId, frames);
          }}
          // `?design=1` gives the board a chat to point at elements, as the chat's own canvas has.
          design={
            params.has('design')
              ? {
                  chatId: 'chat_1',
                  pins: picks,
                  pick: (frame, element, additive) =>
                    pickElement('chat_1', snapshot.canvasId, frame, element, additive),
                  clear: () => {
                    unpinElements('chat_1');
                  },
                  seed: (text, send) => seeds.push({ text, send }),
                }
              : undefined
          }
          frameActions={frameActions}
        />
        {sourceOpen && (
          <aside data-harness-source={sourceOpen} style={{ width: 280, flexShrink: 0 }}>
            Source of {sourceOpen}
          </aside>
        )}
        {RIGHT_INSET > 0 && (
          <aside
            data-harness-inset
            className="bg-raised"
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: RIGHT_INSET }}
          />
        )}
        {params.has('navigator') && (
          <aside
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: 260 }}
          >
            <CanvasColumnTabs canvasId={snapshot.canvasId} />
          </aside>
        )}
      </div>
      {exporting?.revisionId && (
        <ExportToProjectDialog
          appSessionId="chat_1"
          canvasId={snapshot.canvasId}
          revision={{ designId: exporting.designId, revisionId: exporting.revisionId }}
          frameName={exporting.name}
          onClose={() => {
            setExporting(null);
          }}
        />
      )}
      <Toaster />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing harness root');
createRoot(root).render(<Harness />);
