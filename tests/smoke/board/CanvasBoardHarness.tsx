import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasBoard } from '../../../src/features/canvas/CanvasBoard';
import type {
  ArrangeFramesInput,
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
  contrast: 0,
});

const initial: CanvasSnapshot = {
  canvasId: 'cv_board',
  sequence: 1,
  frames: [
    { designId: 'a', name: 'Design A', rect: { x: 100, y: 50, width: 400, height: 300 } },
    { designId: 'b', name: 'Design B', rect: { x: 650, y: 300, width: 400, height: 300 } },
  ].map((frame) => ({
    ...frame,
    layoutVersion: 3,
    revisionId: null,
    designSystem: { id: 'droidex', version: 1, mode: scheme },
    build: { status: 'pending', generation: 1 },
  })),
};
const replies: { resolve: () => void; reject: (error: Error) => void }[] = [];
const calls: ArrangeFramesInput[] = [];

function Harness() {
  const [snapshot, setSnapshot] = useState(initial);
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
  };
  return (
    <div style={{ padding: 24 }}>
      <button type="button" id="outside">
        Outside board
      </button>
      <div style={{ width: 1000, height: 800, marginTop: 12 }}>
        <CanvasBoard
          snapshot={snapshot}
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
