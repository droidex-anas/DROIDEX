// One frame on the board: the header that names it and drags it, the body the
// design is laid out in, and the handles that change the design's viewport
// dimensions.
//
// The body is exactly the frame's rect in world units, so the guest inside it
// lays out at the size the design is being built for and the board's transform
// is the only thing that scales it (spec §4). The header and the handles are
// counter-scaled, because chrome that shrinks with the board is unusable on a
// 50-frame canvas.

import { type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { FrameHandle } from './canvasGeometry';
import { activityStageOf, canvasActivity, type CanvasMotion } from './canvasMotion';
import type { BoardMode } from './canvasState';
import { PendingBloom } from './PendingBloom';
import { previewRevisionId, unmountedLabel } from './previewLabels';
import type { CanvasBuildState, CanvasFrame, FrameRect } from './protocol';

/** Screen pixels a resize handle covers, whatever the board's scale is. */
const HANDLE_PX = 10;

export interface DesignFrameProps {
  frame: CanvasFrame;
  /** Where the board draws it: under the hand, pending, or acknowledged. */
  rect: FrameRect;
  /** The board's scale, so the frame's chrome stays legible at any zoom. */
  scale: number;
  /** Spec §11's timings, resolved against the reduced-motion preference. */
  motion: CanvasMotion;
  /** The frame is inside the board's own box, so its bloom may run. */
  visible: boolean;
  mode: BoardMode;
  selected: boolean;
  /** This is the frame Interact is driving. */
  interacted: boolean;
  /** A hand gesture is holding this frame right now. */
  held: boolean;
  /**
   * Spec §4: Select installs a transparent overlay over the guest and Interact
   * removes it. The board owns when flipping it is safe; this only paints it.
   */
  capturePointer: boolean;
  /** The live preview, or null when this frame holds no slot. */
  preview: ReactNode | null;
  /** It held a live slot and lost it, so returning reloads the design. */
  released: boolean;
  onHold: (frame: CanvasFrame, handle: FrameHandle, event: PointerEvent<HTMLElement>) => void;
  onPick: (frame: CanvasFrame, additive: boolean) => void;
  onInteract: (frame: CanvasFrame) => void;
  onExitInteract: () => void;
}

export function DesignFrame({
  frame,
  rect,
  scale,
  motion,
  visible,
  mode,
  selected,
  interacted,
  held,
  capturePointer,
  preview,
  released,
  onHold,
  onPick,
  onInteract,
  onExitInteract,
}: DesignFrameProps) {
  return (
    <div
      data-design-frame={frame.designId}
      data-selected={selected || undefined}
      className={`group absolute ${motion.frameArrivalMs > 0 ? 'canvas-frame-arrival' : ''}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...arrival(motion),
      }}
    >
      <FrameHeader
        frame={frame}
        rect={rect}
        scale={scale}
        selected={selected}
        interacted={interacted}
        held={held}
        onHold={onHold}
        onPick={onPick}
        onInteract={onInteract}
      />

      <div
        // The body is the design's, never the board's background: in Interact
        // the pointer belongs to the preview, and in Select the overlay above
        // has already decided what the press meant.
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        className={`relative h-full w-full overflow-hidden rounded-xl bg-droid-raised shadow-droid-sm ${
          selected ? 'ring-1 ring-droid-accent/30' : ''
        }`}
      >
        <FrameBody
          build={frame.build}
          motion={motion}
          visible={visible}
          preview={preview}
          released={released}
        />
        {capturePointer && (
          <div
            data-canvas-input-overlay
            className="absolute inset-0"
            style={{ cursor: 'default', touchAction: 'none' }}
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

      {interacted && (
        <button
          type="button"
          aria-label="Return to Select"
          title="Return to Select (Escape)"
          className="absolute right-0 top-full rounded-lg bg-droid-elevated px-1.5 py-0.5 text-[11px] text-droid-text-secondary hover:bg-droid-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/30"
          style={{ transform: `scale(${String(1 / scale)})`, transformOrigin: '100% 0' }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={onExitInteract}
        >
          Return to Select
        </button>
      )}

      {selected && mode === 'select' && (
        <>
          <ResizeHandle frame={frame} rect={rect} scale={scale} handle="east" onHold={onHold} />
          <ResizeHandle frame={frame} rect={rect} scale={scale} handle="south" onHold={onHold} />
          <ResizeHandle
            frame={frame}
            rect={rect}
            scale={scale}
            handle="southeast"
            onHold={onHold}
          />
        </>
      )}
    </div>
  );
}

/**
 * The frame's name and size, and the handle that drags it in either mode
 * (spec §4). It sits above the body and outside the Select overlay, so a drag
 * is always available even while the preview owns the pointer.
 *
 * It is also the keyboard's way onto the board: the headers are the frames'
 * tab stops, and the board reads arrows, Escape and Enter from whichever one
 * holds focus.
 */
function FrameHeader({
  frame,
  rect,
  scale,
  selected,
  interacted,
  held,
  onHold,
  onPick,
  onInteract,
}: Pick<
  DesignFrameProps,
  | 'frame'
  | 'rect'
  | 'scale'
  | 'selected'
  | 'interacted'
  | 'held'
  | 'onHold'
  | 'onPick'
  | 'onInteract'
>) {
  return (
    <div
      data-frame-header
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="absolute bottom-full left-0 flex max-w-full items-center gap-2 rounded-lg px-1.5 py-0.5 text-[11px] outline-none transition-colors hover:bg-droid-elevated focus-visible:bg-droid-elevated focus-visible:ring-1 focus-visible:ring-droid-accent/40"
      style={{
        cursor: held ? 'grabbing' : 'grab',
        touchAction: 'none',
        transform: `scale(${String(1 / scale)})`,
        transformOrigin: '0 100%',
        // The counter-scale shrinks the row's own box, so the name still has the
        // frame's width to run out to rather than the scaled remainder of it.
        width: rect.width * scale,
      }}
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
      <span className={`truncate ${selected ? 'text-droid-text' : 'text-droid-text-secondary'}`}>
        {frame.name}
      </span>
      {interacted && <span className="shrink-0 text-droid-accent">Interacting</span>}
      <span
        className={`shrink-0 text-droid-text-muted transition-opacity group-hover:opacity-100 ${
          selected || held ? '' : 'opacity-0'
        }`}
      >
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </span>
    </div>
  );
}

const HANDLE_CURSOR: Record<Exclude<FrameHandle, 'move'>, string> = {
  east: 'ew-resize',
  south: 'ns-resize',
  southeast: 'nwse-resize',
};

/**
 * One resize handle. Spec §4: resize changes the frame's viewport dimensions,
 * so dragging these is what makes a responsive layout real.
 */
function ResizeHandle({
  frame,
  rect,
  scale,
  handle,
  onHold,
}: {
  frame: CanvasFrame;
  rect: FrameRect;
  scale: number;
  handle: Exclude<FrameHandle, 'move'>;
  onHold: DesignFrameProps['onHold'];
}) {
  return (
    <span
      role="presentation"
      aria-hidden
      className="absolute rounded-full bg-droid-accent/70"
      style={{
        left: handle === 'south' ? rect.width / 2 : rect.width,
        top: handle === 'east' ? rect.height / 2 : rect.height,
        width: HANDLE_PX,
        height: HANDLE_PX,
        transform: `translate(-50%, -50%) scale(${String(1 / scale)})`,
        cursor: HANDLE_CURSOR[handle],
        touchAction: 'none',
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onHold(frame, handle, event);
      }}
    />
  );
}

/**
 * Spec §11: a new frame fades in with at most `frameArrivalTravelPx` of travel.
 * Reduced motion zeroes both tokens, which leaves no animation to attach.
 */
function arrival(motion: CanvasMotion): CSSProperties | undefined {
  if (motion.frameArrivalMs === 0) return undefined;
  return {
    animationDuration: `${String(motion.frameArrivalMs)}ms`,
    animationTimingFunction: motion.easeCss,
    '--canvas-frame-travel': `${String(motion.frameArrivalTravelPx)}px`,
  } as CSSProperties;
}

/**
 * What is inside the frame: its live preview, the bloom for a design still
 * being written or built, or the line a frame with no mounted document says.
 * A frame that failed or was cancelled has a sentence rather than a stage.
 */
function FrameBody({
  build,
  motion,
  visible,
  preview,
  released,
}: Pick<DesignFrameProps, 'motion' | 'visible' | 'preview' | 'released'> & {
  build: CanvasBuildState;
}) {
  const stage = previewRevisionId(build) === null ? activityStageOf(build.status) : null;
  if (stage !== null && (stage === 'queued' || canvasActivity[stage].bloom)) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <PendingBloom stage={stage} visible={visible} motion={motion} />
      </div>
    );
  }
  if (preview) return preview;
  return (
    <p className="flex h-full w-full items-center justify-center px-4 text-center text-[12px] leading-5 text-droid-text-secondary">
      {unmountedLabel(build, released)}
    </p>
  );
}
