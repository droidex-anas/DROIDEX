// The board's own tools, floating on it the way a design tool's do: Select,
// Interact, Edit element, Design, the annotation tools and Fit in a raised rail at the top left, the
// zoom bar at the bottom left, and align and distribute centred at the bottom
// while a multiple selection gives them work (spec §4). Every control works on
// the board behind it, and each names its keyboard shortcut.

import type { ReactNode } from 'react';
import {
  Maximize,
  MousePointer,
  MousePointerSquareDashed,
  Play,
  SlidersHorizontal,
} from '@droidex/icons';
import { ALT_MODIFIER_LABEL } from '../../lib/shortcuts';
import { Tool } from './BoardTool';
import type { AlignEdge, DistributeAxis } from './canvasGeometry';
import { revealStyle, type CanvasMotion } from './canvasMotion';
import type { BoardMode } from './canvasState';
import { ZoomControl, type ZoomCommand } from './ZoomControl';

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

export interface BoardControlsProps {
  scale: number;
  /** Spec §11's timings; the selection bar reveals on the popover token. */
  motion: CanvasMotion;
  mode: BoardMode;
  selectedCount: number;
  /** A board with no frames has nothing to interact with or fit. */
  hasFrames: boolean;
  /** Design points a chat's next prompt at elements, so only the chat's own canvas offers it. */
  canDesign: boolean;
  /** What the board's tools last could not do, named for the user; the first one shows. */
  errors: readonly string[];
  onMode: (mode: BoardMode) => void;
  onZoom: (command: ZoomCommand) => void;
  /** A zoom typed as a percentage, as a scale. */
  onZoomTo: (scale: number) => void;
  /** Hands the keyboard back to the board, as a typed zoom does once it is done. */
  focusBoard: () => void;
  onAlign: (edge: AlignEdge) => void;
  onDistribute: (axis: DistributeAxis) => void;
  /** The rail's annotation group, which the board owns. */
  annotationTools: ReactNode;
}

export function BoardControls({
  scale,
  motion,
  mode,
  selectedCount,
  hasFrames,
  canDesign,
  errors,
  onMode,
  onZoom,
  onZoomTo,
  focusBoard,
  onAlign,
  onDistribute,
  annotationTools,
}: BoardControlsProps) {
  return (
    <div
      data-board-controls
      // The tools are not background: a pan started here would capture the
      // pointer and the buttons would never see their clicks.
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div role="group" aria-label="Board input mode" className="canvas-rail">
        <Tool
          label="Select"
          tip={`Select  V · Hold ${ALT_MODIFIER_LABEL} to measure`}
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
        <Tool
          label="Edit element"
          tip={`Edit element  E · Hold ${ALT_MODIFIER_LABEL} to measure`}
          pressed={mode === 'edit'}
          disabled={!hasFrames}
          onClick={() => {
            onMode('edit');
          }}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
        </Tool>
        {canDesign && (
          <Tool
            label="Design"
            tip="Design  D"
            pressed={mode === 'design'}
            disabled={!hasFrames}
            onClick={() => {
              onMode('design');
            }}
          >
            <MousePointerSquareDashed className="h-4 w-4" aria-hidden />
          </Tool>
        )}
        <span aria-hidden className="canvas-rail-divider" />
        {annotationTools}
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

      <ZoomControl
        scale={scale}
        hasFrames={hasFrames}
        hasSelection={selectedCount > 0}
        onZoom={onZoom}
        onZoomTo={onZoomTo}
        focusBoard={focusBoard}
      />

      {selectedCount >= 2 && (
        <div
          style={revealStyle(motion)}
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

      {errors.some(Boolean) && (
        <p role="alert" className="canvas-board-alert">
          {errors.find(Boolean)}
        </p>
      )}
    </div>
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
