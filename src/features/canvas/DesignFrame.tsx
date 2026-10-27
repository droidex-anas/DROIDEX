// One frame on the board: the sheet the design is laid out on, the label that
// names it and drags it, and, while it is selected, its size, its resize
// handles and its actions.
//
// The sheet is exactly the frame's rect in world units, so the guest inside it
// lays out at the size the design is being built for and the board's transform
// is the only thing that scales it (spec §4). Everything else is chrome drawn
// at screen size: the board stylesheet divides it by --board-scale, because
// chrome that shrinks with the board is unusable on a 50-frame canvas.

import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { AlertTriangle } from '@droidex/icons';
import type { FrameHandle, Point } from './canvasGeometry';
import type { CanvasMotion } from './canvasMotion';
import type { BoardMode } from './canvasState';
import { FrameLabel, FrameNameField } from './FrameLabel';
import { FrameThumbnail } from './FrameThumbnail';
import { FrameToolbar, type FrameActions } from './FrameToolbar';
import { PendingBloom } from './PendingBloom';
import { diagnosticPlace, isPending, sheetState, type SheetState } from './previewLabels';
import type { CanvasFrame, FrameRect } from './protocol';

/** Below this on screen a sheet shows its title alone, without the detail. */
const COMPACT_SHEET_PX = { width: 220, height: 140 };
/** Below this a sheet has no room for words; the label above still names it. */
const TINY_SHEET_PX = { width: 120, height: 72 };

export interface DesignFrameProps {
  canvasId: string;
  frame: CanvasFrame;
  /** Where the board draws it: under the hand, pending, or acknowledged. */
  rect: FrameRect;
  /** The board's scale, so the frame's chrome can be laid out in screen pixels. */
  scale: number;
  /** Screen pixels from the frame's left edge to the board's right edge. */
  roomRight: number;
  /** Spec §11's timings, resolved against the reduced-motion preference. */
  motion: CanvasMotion;
  /** It joined the board after the board opened, so it arrives with motion. */
  arriving: boolean;
  /** The frame is inside the board's own box, so its bloom may run. */
  visible: boolean;
  mode: BoardMode;
  selected: boolean;
  /** It is the only frame selected, or the one Interact drives: it shows its toolbar. */
  showTools: boolean;
  /** This is the frame Interact is driving. */
  interacted: boolean;
  /** A hand gesture is holding this frame right now. */
  held: boolean;
  /** This chat's agent has a turn running, so a frame with no source is being written. */
  agentWorking: boolean;
  /**
   * Spec §4: Select and Edit install a transparent overlay over the guest and
   * Interact removes it. The board owns when flipping it is safe; this only paints it.
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
  /** A press in Edit, at a point in the design's own pixels. */
  onPickElement: (frame: CanvasFrame, at: Point) => void;
  /** Enter on the label in Edit. */
  onEditEnter: (frame: CanvasFrame) => void;
  /** The box of the element Edit has picked in this frame, in the design's pixels. */
  elementBox: FrameRect | null;
  /** This frame's label holds the frames' one tab stop. */
  tabStop: boolean;
  onFocusLabel: (frame: CanvasFrame) => void;
  onExitInteract: () => void;
  onOpenSource?: (designId: string) => void;
  /** The frame is pinned to the chat's next prompt. */
  inChat: boolean;
  /** Pins it to the chat's next prompt or takes it off; absent where it cannot be pinned. */
  onToggleChat?: (frame: CanvasFrame) => void;
  actions: FrameActions;
  /** Deletes the selection, which is this frame while it shows its toolbar. */
  onDelete: () => void;
}

export function DesignFrame(props: DesignFrameProps) {
  const { frame, rect, scale, motion, arriving, mode, selected, showTools, held } = props;
  const { capturePointer, onHold, onPick, onInteract, onPickElement, onEditEnter } = props;
  const { elementBox } = props;
  const [renaming, setRenaming] = useState(false);
  const label = useRef<HTMLDivElement>(null);
  const animated = arriving && motion.frameArrivalMs > 0;
  const screenWidth = rect.width * scale;
  const focusLabel = () => label.current?.focus({ preventScroll: true });
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
      {renaming ? (
        <FrameNameField
          frame={frame}
          width={screenWidth}
          onRename={props.actions.rename}
          onDone={() => {
            // The label has to be back before it can take the keyboard.
            flushSync(() => {
              setRenaming(false);
            });
            focusLabel();
          }}
        />
      ) : (
        <FrameLabel
          ref={label}
          frame={frame}
          width={screenWidth}
          selected={selected}
          interacted={props.interacted}
          held={held}
          tabStop={props.tabStop}
          onHold={onHold}
          onPick={onPick}
          onInteract={onInteract}
          onEnter={(picked) => {
            // Edit goes into the frame's elements; otherwise Enter picks the
            // frame, and on one already picked starts interacting with it.
            if (mode === 'edit') {
              onPick(picked, false);
              onEditEnter(picked);
            } else if (selected) onInteract(picked);
            else onPick(picked, false);
          }}
          onFocusLabel={props.onFocusLabel}
        />
      )}
      {showTools && !held && (
        <FrameToolbar
          frame={frame}
          interacted={props.interacted}
          roomRight={props.roomRight}
          inChat={props.inChat}
          actions={props.actions}
          onInteract={onInteract}
          onExitInteract={props.onExitInteract}
          onOpenSource={props.onOpenSource}
          onToggleChat={props.onToggleChat}
          onRename={() => {
            setRenaming(true);
          }}
          onDelete={props.onDelete}
          onLeave={focusLabel}
        />
      )}

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
              if (mode === 'edit') {
                onPick(frame, false);
                const box = event.currentTarget.getBoundingClientRect();
                onPickElement(frame, {
                  x: (event.clientX - box.left) / scale,
                  y: (event.clientY - box.top) / scale,
                });
                return;
              }
              onPick(frame, event.shiftKey);
              if (!event.shiftKey) onHold(frame, 'move', event);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (mode === 'select') onInteract(frame);
            }}
          />
        )}
        {elementBox && (
          <div
            aria-hidden
            className="canvas-element-outline"
            style={{
              left: elementBox.x,
              top: elementBox.y,
              width: elementBox.width,
              height: elementBox.height,
            }}
          />
        )}
      </div>

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
  const fits = (box: { width: number; height: number }) =>
    rect.width * scale >= box.width && rect.height * scale >= box.height;
  const content = (
    <SheetContent
      state={state}
      compact={!fits(COMPACT_SHEET_PX)}
      tiny={!fits(TINY_SHEET_PX)}
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
  tiny,
  motion,
  visible,
  onOpenSource,
}: {
  state: SheetState;
  compact: boolean;
  tiny: boolean;
  motion: CanvasMotion;
  visible: boolean;
  onOpenSource?: () => void;
}) {
  return (
    <div
      className="canvas-sheet-state"
      data-compact={compact || undefined}
      data-tiny={tiny || undefined}
    >
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

/** A build that failed: where, why, and the way in. */
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
