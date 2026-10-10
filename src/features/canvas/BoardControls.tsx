// The board's own tools, floating on it the way a design tool's do: Select,
// Interact and Fit in a raised rail at the top left, the zoom readout and its
// menu at the bottom left, and align and distribute centred at the bottom while
// a multiple selection gives them work (spec §4). Every control works on the
// board behind it, and each names its keyboard shortcut.

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize, MousePointer, Play } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import type { AlignEdge, DistributeAxis } from './canvasGeometry';
import type { CanvasMotion } from './canvasMotion';
import type { BoardMode } from './canvasState';
import { MenuRow } from './menuRows';

/** What the zoom menu and its shortcuts can ask the board to do. */
export type ZoomCommand = 'in' | 'out' | 'fit' | 'selection' | 'actual';

/** A guide line with two bars sitting against it: every align glyph in one shape. */
function guided(guide: string, bars: ReactNode[]): ReactNode {
  return (
    <>
      <path d={guide} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {bars}
    </>
  );
}

function bar(x: number, y: number, width: number, height: number): ReactNode {
  return (
    <rect
      key={`${String(x)}-${String(y)}`}
      x={x}
      y={y}
      width={width}
      height={height}
      rx="1.5"
      fill="currentColor"
    />
  );
}

const ALIGN_ACTIONS: { edge: AlignEdge; label: string; glyph: ReactNode }[] = [
  {
    edge: 'left',
    label: 'Align left edges',
    glyph: guided('M4 3V21', [bar(5, 6, 12, 4), bar(5, 14, 7, 4)]),
  },
  {
    edge: 'centerX',
    label: 'Align horizontal centres',
    glyph: guided('M12 3V21', [bar(6, 6, 12, 4), bar(8.5, 14, 7, 4)]),
  },
  {
    edge: 'right',
    label: 'Align right edges',
    glyph: guided('M20 3V21', [bar(7, 6, 12, 4), bar(12, 14, 7, 4)]),
  },
  {
    edge: 'top',
    label: 'Align top edges',
    glyph: guided('M3 4H21', [bar(6, 5, 4, 12), bar(14, 5, 4, 7)]),
  },
  {
    edge: 'centerY',
    label: 'Align vertical centres',
    glyph: guided('M3 12H21', [bar(6, 6, 4, 12), bar(14, 8.5, 4, 7)]),
  },
  {
    edge: 'bottom',
    label: 'Align bottom edges',
    glyph: guided('M3 20H21', [bar(6, 7, 4, 12), bar(14, 12, 4, 7)]),
  },
];

const DISTRIBUTE_ACTIONS: { axis: DistributeAxis; label: string; glyph: ReactNode }[] = [
  {
    axis: 'horizontal',
    label: 'Space evenly across',
    glyph: [bar(4, 5, 3, 14), bar(10.5, 5, 3, 14), bar(17, 5, 3, 14)],
  },
  {
    axis: 'vertical',
    label: 'Space evenly down',
    glyph: [bar(5, 4, 14, 3), bar(5, 10.5, 14, 3), bar(5, 17, 14, 3)],
  },
];

const ZOOM_ACTIONS: { command: ZoomCommand; label: string; hint: string }[] = [
  { command: 'in', label: 'Zoom in', hint: '+' },
  { command: 'out', label: 'Zoom out', hint: '−' },
  { command: 'fit', label: 'Zoom to fit', hint: '⇧1' },
  { command: 'selection', label: 'Zoom to selection', hint: '⇧2' },
  { command: 'actual', label: 'Zoom to 100%', hint: '⇧0' },
];

export interface BoardControlsProps {
  scale: number;
  /** Spec §11's timings; the selection bar reveals on the popover token. */
  motion: CanvasMotion;
  mode: BoardMode;
  selectedCount: number;
  /** A board with no frames has nothing to interact with or fit. */
  hasFrames: boolean;
  /** The last refused layout write, named for the user. */
  error: string;
  onMode: (mode: BoardMode) => void;
  onZoom: (command: ZoomCommand) => void;
  onAlign: (edge: AlignEdge) => void;
  onDistribute: (axis: DistributeAxis) => void;
}

export function BoardControls({
  scale,
  motion,
  mode,
  selectedCount,
  hasFrames,
  error,
  onMode,
  onZoom,
  onAlign,
  onDistribute,
}: BoardControlsProps) {
  return (
    <div
      // The tools are not background: a pan started here would capture the
      // pointer and the buttons would never see their clicks.
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div role="group" aria-label="Board input mode" className="canvas-rail">
        <Tool
          label="Select"
          tip="Select  V"
          pressed={mode === 'select'}
          onClick={() => {
            onMode('select');
          }}
        >
          <MousePointer className="h-4 w-4" aria-hidden />
        </Tool>
        <Tool
          label="Interact"
          tip="Interact  I"
          pressed={mode === 'interact'}
          disabled={!hasFrames}
          onClick={() => {
            onMode('interact');
          }}
        >
          <Play className="h-4 w-4" aria-hidden />
        </Tool>
        <span aria-hidden className="canvas-rail-divider" />
        <Tool
          label="Fit"
          tip="Zoom to fit  ⇧1"
          disabled={!hasFrames}
          onClick={() => {
            onZoom('fit');
          }}
        >
          <Maximize className="h-4 w-4" aria-hidden />
        </Tool>
      </div>

      <ZoomReadout
        scale={scale}
        hasFrames={hasFrames}
        hasSelection={selectedCount > 0}
        onZoom={onZoom}
      />

      {selectedCount >= 2 && (
        <div
          style={reveal(motion)}
          className={`canvas-selection-bar ${motion.popoverMs > 0 ? 'canvas-popover-reveal' : ''}`}
        >
          {ALIGN_ACTIONS.map(({ edge, label, glyph }) => (
            <GlyphTool
              key={edge}
              label={label}
              glyph={glyph}
              onClick={() => {
                onAlign(edge);
              }}
            />
          ))}
          <span aria-hidden className="canvas-rail-divider" />
          {DISTRIBUTE_ACTIONS.map(({ axis, label, glyph }) => (
            <GlyphTool
              key={axis}
              label={label}
              glyph={glyph}
              // Two frames have no space between them to spread.
              disabled={selectedCount < 3}
              onClick={() => {
                onDistribute(axis);
              }}
            />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="canvas-board-alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The zoom readout, which opens the zoom menu. */
function ZoomReadout({
  scale,
  hasFrames,
  hasSelection,
  onZoom,
}: {
  scale: number;
  hasFrames: boolean;
  hasSelection: boolean;
  onZoom: (command: ZoomCommand) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const enabled: Record<ZoomCommand, boolean> = {
    in: true,
    out: true,
    fit: hasFrames,
    selection: hasSelection,
    actual: true,
  };
  return (
    <div className="canvas-zoom">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Zoom ${String(Math.round(scale * 100))}%`}
        className="canvas-zoom-value"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {Math.round(scale * 100)}%
      </button>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={trigger}
        label="Zoom"
        align="left"
        width={208}
      >
        <div role="menu" aria-label="Zoom" className="p-1">
          {ZOOM_ACTIONS.map(({ command, label, hint }) => (
            <MenuRow
              key={command}
              label={label}
              hint={hint}
              disabled={!enabled[command]}
              onRun={() => {
                setOpen(false);
                onZoom(command);
              }}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Spec §11: a toolbar reveal is `popoverMs` and at most `popoverTravelPx`. */
function reveal(motion: CanvasMotion): CSSProperties | undefined {
  if (motion.popoverMs === 0) return undefined;
  return {
    animationDuration: `${String(motion.popoverMs)}ms`,
    animationTimingFunction: motion.easeCss,
    '--canvas-popover-travel': `${String(motion.popoverTravelPx)}px`,
  } as CSSProperties;
}

/** One rail tool: its accessible name is the plain label, its tip adds the key. */
function Tool({
  label,
  tip,
  pressed,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-tip={tip}
      disabled={disabled}
      onClick={onClick}
      className="canvas-tool"
    >
      {children}
    </button>
  );
}

function GlyphTool({
  label,
  glyph,
  disabled = false,
  onClick,
}: {
  label: string;
  glyph: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="canvas-tool"
    >
      <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden>
        {glyph}
      </svg>
    </button>
  );
}
