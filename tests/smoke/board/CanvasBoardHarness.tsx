import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  Annotation,
  AnnotateCanvasInput,
} from '../../../src/features/canvas/annotationProtocol';
import { applyCanvasChange } from '../../../src/features/canvas/applyCanvasChange';
import { CanvasBoard, type CanvasBoardHandle } from '../../../src/features/canvas/CanvasBoard';
import { SELECT_MODE, type BoardInteraction } from '../../../src/features/canvas/canvasState';
import { CanvasRequestError } from '../../../src/features/canvas/client';
import { DesignPreview } from '../../../src/features/canvas/DesignPreview';
import type {
  ArrangeFramesInput,
  CanvasFrame,
  CanvasSnapshot,
  FrameRect,
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
      build: params.has('building')
        ? { status: 'building', generation: 1 }
        : {
            status: 'ready',
            generation: 1,
            revisionId: 'rev_01',
            artifactId: 'a'.repeat(64),
            elements: [],
            diagnostics: [],
          },
    }),
  ),
};
const replies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const calls: ArrangeFramesInput[] = [];
const annotateCalls: AnnotateCanvasInput[] = [];
const annotateReplies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const previewClicks: string[] = [];
const readArtifact = () => Promise.resolve({ artifactId: 'a'.repeat(64), html: '<p>Ready</p>' });

function Harness() {
  const [snapshot, setSnapshot] = useState(initial);
  const [interaction, setInteraction] = useState(SELECT_MODE);
  const [width, setWidth] = useState(1000);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const board = useRef<CanvasBoardHandle>(null);
  const live = useRef(interaction);
  live.current = interaction;
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
        frames: current.frames.map((frame) => ({
          ...frame,
          build: {
            status: 'ready',
            generation: 1,
            revisionId: 'rev_01',
            artifactId: 'a'.repeat(64),
            elements: [],
            diagnostics: [],
          },
        })),
      })),
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
          renderPreview={(frame, revisionId) =>
            params.get('preview') === 'guest' ? (
              <DesignPreview
                canvasId={snapshot.canvasId}
                frame={frame}
                revisionId={revisionId}
                readArtifact={readArtifact}
                reportPreview={() => undefined}
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
          onOpenSource={setSourceOpen}
        />
        {sourceOpen && (
          <aside data-harness-source={sourceOpen} style={{ width: 280, flexShrink: 0 }}>
            Source of {sourceOpen}
          </aside>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing harness root');
createRoot(root).render(<Harness />);
