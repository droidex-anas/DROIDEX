// The board's own control strip: the zoom readout bottom-left, and Select /
// Interact, Fit, align and distribute bottom-right (spec §4). Every control
// here works on the board behind it; 5d's frame toolbar gathers the rest of the
// context actions, and 5e gives the expanded board its top row.
//
// Align and distribute appear only when a multiple selection gives them
// something to do, so the resting board stays quiet.

import type { CSSProperties, ReactNode } from 'react';
import type { AlignEdge, DistributeAxis } from './canvasGeometry';
import type { CanvasMotion } from './canvasMotion';
import type { BoardMode } from './canvasState';

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
  /** Spec §11's timings; the strip reveals on the popover token. */
  motion: CanvasMotion;
  mode: BoardMode;
  selectedCount: number;
  /** A board with no frames has nothing to interact with or fit. */
  hasFrames: boolean;
  /** The last refused layout write, named for the user. */
  error: string;
  onMode: (mode: BoardMode) => void;
  onFit: () => void;
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
  onFit,
  onAlign,
  onDistribute,
}: BoardControlsProps) {
  return (
    <div
      // The strip is not background: a pan started here would capture the
      // pointer and the buttons would never see their clicks.
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3"
    >
      <span className="rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text-secondary">
        {Math.round(scale * 100)}%
      </span>
      <div className="flex min-w-0 flex-col items-end gap-2">
        {selectedCount >= 2 && (
          <div
            style={reveal(motion)}
            className={`pointer-events-auto flex items-center gap-0.5 rounded-full bg-droid-elevated p-1 ${
              motion.popoverMs > 0 ? 'canvas-popover-reveal' : ''
            }`}
          >
            {ALIGN_ACTIONS.map(({ edge, label, glyph }) => (
              <GlyphButton
                key={edge}
                label={label}
                glyph={glyph}
                onClick={() => {
                  onAlign(edge);
                }}
              />
            ))}
            <span aria-hidden className="mx-0.5 h-4 w-px bg-droid-border" />
            {DISTRIBUTE_ACTIONS.map(({ axis, label, glyph }) => (
              <GlyphButton
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
        <div className="flex min-w-0 items-center gap-2">
          {error && (
            <p
              role="alert"
              className="truncate rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-red"
            >
              {error}
            </p>
          )}
          <div
            role="group"
            aria-label="Board input mode"
            className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-droid-elevated p-0.5"
          >
            <ModeOption
              label="Select"
              active={mode === 'select'}
              onClick={() => {
                onMode('select');
              }}
            />
            <ModeOption
              label="Interact"
              active={mode === 'interact'}
              disabled={!hasFrames}
              onClick={() => {
                onMode('interact');
              }}
            />
          </div>
          <button
            type="button"
            disabled={!hasFrames}
            onClick={onFit}
            className="pointer-events-auto rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text-secondary transition-colors hover:bg-droid-active disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
          >
            Fit
          </button>
        </div>
      </div>
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

function ModeOption({
  label,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 ${
        active
          ? 'bg-droid-accent/15 font-medium text-droid-text'
          : 'text-droid-text-secondary hover:bg-droid-active'
      }`}
    >
      {label}
    </button>
  );
}

function GlyphButton({
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
      className="flex h-6 w-6 items-center justify-center rounded-full text-droid-text-secondary transition-colors hover:bg-droid-active hover:text-droid-text disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
    >
      <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden>
        {glyph}
      </svg>
    </button>
  );
}
