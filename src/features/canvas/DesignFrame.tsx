// One frame on the board: the sheet the design is laid out on, the label that
// names it and drags it, and, while it is selected, its size, its resize
// handles and its actions.
//
// The sheet is exactly the frame's rect in world units, so the guest inside it
// lays out at the size the design is being built for and the board's transform
// is the only thing that scales it (spec §4). Everything else is chrome drawn
// at screen size: the board stylesheet divides it by --board-scale, because
// chrome that shrinks with the board is unusable on a 50-frame canvas.

import { type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { AlertTriangle, Play } from '@droidex/icons';
import type { FrameHandle } from './canvasGeometry';
import type { CanvasMotion } from './canvasMotion';
import type { BoardMode } from './canvasState';
import { FrameThumbnail } from './FrameThumbnail';
import { PendingBloom } from './PendingBloom';
import { diagnosticPlace, isPending, sheetState, type SheetState } from './previewLabels';
import type { CanvasFrame, FrameRect } from './protocol';

/** Screen room the selected frame's actions take at the right of its label row. */
const TOOLS_PX = 168;
/** Below this on screen a sheet shows its title alone, without the detail. */
const COMPACT_SHEET_PX = { width: 220, height: 140 };

export interface DesignFrameProps {
  canvasId: string;
  frame: CanvasFrame;
  /** Where the board draws it: under the hand, pending, or acknowledged. */
  rect: FrameRect;
  /** The board's scale, so the frame's chrome can be laid out in screen pixels. */
  scale: number;
  /** Spec §11's timings, resolved against the reduced-motion preference. */
  motion: CanvasMotion;
  /** It joined the board after the board opened, so it arrives with motion. */
  arriving: boolean;
  /** The frame is inside the board's own box, so its bloom may run. */
  visible: boolean;
  mode: BoardMode;
  selected: boolean;
  /** It is the only frame selected, or the one Interact drives: it shows its actions. */
  showTools: boolean;
  /** This is the frame Interact is driving. */
  interacted: boolean;
  /** A hand gesture is holding this frame right now. */
  held: boolean;
  /** This chat's agent has a turn running, so a frame with no source is being written. */
  agentWorking: boolean;
  /**
   * Spec §4: Select installs a transparent overlay over the guest and Interact
   * removes it. The board owns when flipping it is safe; this only paints it.
   */
  capturePointer: boolean;
  /** The revision on show: its working one, or the one it showed before a newer build. */
  shownRevisionId: string | null;
  /** The live preview, or null when this frame holds no slot. */
  preview: ReactNode | null;
  /** It held a live slot and lost it, so returning reloads the design. */
  released: boolean;
  onHold: (frame: CanvasFrame, handle: FrameHandle, event: PointerEvent<HTMLElement>) => void;
  onPick: (frame: CanvasFrame, additive: boolean) => void;
  onInteract: (frame: CanvasFrame) => void;
  onExitInteract: () => void;
  onOpenSource?: (designId: string) => void;
}

export function DesignFrame(props: DesignFrameProps) {
  const { frame, rect, scale, motion, arriving, mode, selected, showTools, held } = props;
  const { capturePointer, onHold, onPick, onInteract } = props;
  const animated = arriving && motion.frameArrivalMs > 0;
  return (
    <div
      data-design-frame={frame.designId}
      data-selected={selected || undefined}
      className={`canvas-frame absolute ${animated ? 'canvas-frame-arrival' : ''}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...(animated ? arrival(motion) : {}),
      }}
    >
      <FrameLabel {...props} width={rect.width * scale - (showTools ? TOOLS_PX : 0)} />

      <div
        // The sheet is the design's, never the board's background: in Interact
        // the pointer belongs to the preview, and in Select the overlay above
        // has already decided what the press meant.
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        className="canvas-sheet"
      >
        <FrameBody {...props} />
        <RebuildBadge {...props} />
        {capturePointer && (
          <div
            data-canvas-input-overlay
            className="absolute inset-0"
            style={{ cursor: held ? 'grabbing' : 'default', touchAction: 'none' }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onPick(frame, event.shiftKey);
              if (!event.shiftKey) onHold(frame, 'move', event);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onInteract(frame);
            }}
          />
        )}
      </div>

      {showTools && <FrameTools {...props} />}

      {selected && (
        <div className="canvas-frame-size canvas-chrome">
          <span>
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      )}

      {selected &&
        mode === 'select' &&
        (['east', 'south', 'southeast'] as const).map((handle) => (
          <span
            key={handle}
            role="presentation"
            aria-hidden
            data-handle={handle}
            className="canvas-frame-handle"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onHold(frame, handle, event);
            }}
          />
        ))}
    </div>
  );
}

/**
 * The frame's name above the sheet, and the handle that drags it in either
 * mode (spec §4). It sits outside the Select overlay, so a drag is always
 * available even while the preview owns the pointer.
 *
 * It is also the keyboard's way onto the board: the labels are the frames'
 * tab stops, and the board reads arrows, Escape and Enter from whichever one
 * holds focus.
 */
function FrameLabel({
  frame,
  width,
  selected,
  interacted,
  held,
  onHold,
  onPick,
  onInteract,
}: DesignFrameProps & { width: number }) {
  return (
    <div
      data-frame-header
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="canvas-frame-label canvas-chrome"
      style={{ cursor: held ? 'grabbing' : 'grab', width: Math.max(0, width) }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onPick(frame, event.shiftKey);
        if (!event.shiftKey) onHold(frame, 'move', event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onInteract(frame);
      }}
      // The keyboard's route to spec §4's click and double-click: Enter picks
      // the frame and Enter on one already picked starts interacting with it,
      // while Space toggles it in a multiple selection.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === ' ') onPick(frame, true);
        else if (selected) onInteract(frame);
        else onPick(frame, false);
      }}
    >
      <span className="canvas-frame-name">{frame.name}</span>
      {interacted && <span className="canvas-frame-note">Interacting</span>}
    </div>
  );
}

/** The selected frame's actions: run it, read its source, or return to Select. */
function FrameTools({
  frame,
  interacted,
  onInteract,
  onExitInteract,
  onOpenSource,
}: DesignFrameProps) {
  return (
    <div
      className="canvas-frame-tools canvas-chrome"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="canvas-frame-toolbar">
        {interacted ? (
          <button
            type="button"
            aria-label="Return to Select"
            title="Return to Select (Escape)"
            className="canvas-frame-tool"
            onClick={onExitInteract}
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Interact with ${frame.name}`}
            title="Interact (double-click)"
            className="canvas-frame-tool"
            onClick={() => {
              onInteract(frame);
            }}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            Interact
          </button>
        )}
        {onOpenSource && (
          <button
            type="button"
            aria-label={`Source of ${frame.name}`}
            className="canvas-frame-tool"
            onClick={() => {
              onOpenSource(frame.designId);
            }}
          >
            <CodeGlyph />
            Source
          </button>
        )}
      </div>
    </div>
  );
}

function CodeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden>
      <path
        d="M9 7 4 12l5 5M15 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Spec §11: a new frame fades in with at most `frameArrivalTravelPx` of travel.
 * Only frames that join an open board arrive; the ones it opened with are
 * simply there.
 */
function arrival(motion: CanvasMotion): CSSProperties {
  return {
    animationDuration: `${String(motion.frameArrivalMs)}ms`,
    animationTimingFunction: motion.easeCss,
    '--canvas-frame-travel': `${String(motion.frameArrivalTravelPx)}px`,
  } as CSSProperties;
}

/**
 * A design still on show while its newer revision queues or builds: the stage,
 * in the corner, so the frame never blanks for a revision in progress.
 */
function RebuildBadge({ frame, shownRevisionId, motion, visible }: DesignFrameProps) {
  const { status } = frame.build;
  if (shownRevisionId === null || !isPending(frame.build) || status === 'cancelled') return null;
  return (
    <div className="canvas-sheet-badge canvas-chrome">
      <PendingBloom
        stage={status === 'building' ? 'building' : 'queued'}
        visible={visible}
        motion={motion}
      />
    </div>
  );
}

/**
 * What is on the sheet: the live preview, or what the frame can truthfully say
 * without one (see `sheetState`).
 */
function FrameBody({
  canvasId,
  frame,
  rect,
  scale,
  motion,
  visible,
  shownRevisionId,
  preview,
  released,
  agentWorking,
  onOpenSource,
}: DesignFrameProps) {
  if (preview) return preview;
  const state = sheetState(frame, shownRevisionId, agentWorking, released);
  const compact =
    rect.width * scale < COMPACT_SHEET_PX.width || rect.height * scale < COMPACT_SHEET_PX.height;
  const content = (
    <SheetContent
      state={state}
      compact={compact}
      motion={motion}
      visible={visible}
      onOpenSource={
        onOpenSource &&
        (() => {
          onOpenSource(frame.designId);
        })
      }
    />
  );
  if (state.kind !== 'still') return content;
  return (
    <FrameThumbnail
      canvasId={canvasId}
      designId={frame.designId}
      revisionId={state.revisionId}
      fallback={content}
    />
  );
}

function SheetContent({
  state,
  compact,
  motion,
  visible,
  onOpenSource,
}: {
  state: SheetState;
  compact: boolean;
  motion: CanvasMotion;
  visible: boolean;
  onOpenSource?: () => void;
}) {
  return (
    <div className="canvas-sheet-state">
      <div className="canvas-sheet-message canvas-chrome">
        {state.kind === 'busy' && (
          <PendingBloom stage={state.stage} visible={visible} motion={motion} />
        )}
        {state.kind === 'note' && (
          <SheetNote title={state.title} detail={state.detail} compact={compact} />
        )}
        {state.kind === 'still' && (
          <SheetNote title="Preview not running" detail={state.detail} compact={compact} />
        )}
        {state.kind === 'failed' && (
          <FailedNote state={state} compact={compact} onOpenSource={onOpenSource} />
        )}
      </div>
    </div>
  );
}

function SheetNote({
  title,
  detail,
  compact,
}: {
  title: string;
  detail: string;
  compact: boolean;
}) {
  return (
    <>
      <p className="canvas-sheet-title">{title}</p>
      {!compact && <p className="canvas-sheet-detail">{detail}</p>}
    </>
  );
}

/** A build that failed with nothing older to show: where, why, and the way in. */
function FailedNote({
  state,
  compact,
  onOpenSource,
}: {
  state: Extract<SheetState, { kind: 'failed' }>;
  compact: boolean;
  onOpenSource?: () => void;
}) {
  const first = state.diagnostics.at(0);
  const more = state.diagnostics.length - 1;
  const place = first ? diagnosticPlace(first) : null;
  return (
    <>
      <AlertTriangle className="h-4 w-4 text-droid-red" aria-hidden />
      <p className="canvas-sheet-title">Didn’t build</p>
      {!compact && first && (
        <p className="canvas-sheet-detail canvas-sheet-clamp">
          {place && <strong>{place} · </strong>}
          {first.message}
        </p>
      )}
      {!compact && more > 0 && <p className="canvas-sheet-detail">and {more} more</p>}
      {!compact && onOpenSource && (
        <button
          type="button"
          className="canvas-sheet-action"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={onOpenSource}
        >
          View source
        </button>
      )}
    </>
  );
}
