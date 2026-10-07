import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasBoard, type CanvasBoardHandle } from '../../../src/features/canvas/CanvasBoard';
import { SELECT_MODE, type BoardInteraction } from '../../../src/features/canvas/canvasState';
import type {
  ArrangeFramesInput,
  CanvasFrame,
  CanvasSnapshot,
  FrameRect,
} from '../../../src/features/canvas/protocol';
import { applyTheme, BUILT_IN_THEMES } from '../../../src/lib/theme';
import '../../../src/index.css';

interface BoardHarness {
  calls: ArrangeFramesInput[];
  publish: (designId: string, rect: FrameRect, layoutVersion: number) => void;
  reject: (index: number) => void;
  resolve: (index: number) => void;
  focusFrame: (frameId: string) => void;
  select: (designIds: string[]) => void;
  interaction: () => BoardInteraction;
  previewClicks: string[];
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

const initial: CanvasSnapshot = {
  canvasId: 'cv_board',
  sequence: 1,
  frames: PLACED.map(
    (frame): CanvasFrame => ({
      ...frame,
      layoutVersion: 3,
      manifestVersion: 1,
      revisionId: null,
      designSystem: { id: 'droidex', version: 1, mode: scheme },
      build: { status: 'pending', generation: 1 },
    }),
  ),
};
const replies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const calls: ArrangeFramesInput[] = [];
const previewClicks: string[] = [];

function Harness() {
  const [snapshot, setSnapshot] = useState(initial);
  const [interaction, setInteraction] = useState(SELECT_MODE);
  const board = useRef<CanvasBoardHandle>(null);
  const live = useRef(interaction);
  live.current = interaction;
  window.boardHarness = {
    calls,
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
  };
  return (
    <div style={{ padding: 24 }}>
      <button type="button" id="outside" aria-pressed={interaction.selectedFrameIds.length > 0}>
        Outside board
      </button>
      <div style={{ width: 1000, height: 800, marginTop: 12 }}>
        <CanvasBoard
          ref={board}
          snapshot={snapshot}
          interaction={interaction}
          onInteractionChange={setInteraction}
          renderPreview={(frame) => (
            <button
              type="button"
              data-harness-preview={frame.designId}
              onPointerDown={() => previewClicks.push(frame.designId)}
              style={{ width: '100%', height: '100%' }}
            >
              {frame.name} preview
            </button>
          )}
          onArrangeFrames={(input) => {
            calls.push(input);
            return new Promise<void>((resolve, reject) => replies.push({ resolve, reject }));
          }}
        />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing harness root');
createRoot(root).render(<Harness />);
