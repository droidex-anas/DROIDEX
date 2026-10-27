// A frame's name above its sheet, and the handle that drags it in either mode
// (spec §4). It sits outside the Select overlay, so a drag is always available
// even while the preview owns the pointer.
//
// It is also the keyboard's way onto the board. The labels share one tab stop,
// the frame focus last rested on, and the board moves focus between them with
// the arrows, Home and End in reading order.

import type { PointerEvent } from 'react';
import type { FrameHandle } from './canvasGeometry';
import type { CanvasFrame } from './protocol';

export function FrameLabel({
  frame,
  width,
  selected,
  interacted,
  held,
  tabStop,
  onHold,
  onPick,
  onInteract,
  onEnter,
  onFocusLabel,
}: {
  frame: CanvasFrame;
  /** Screen pixels the label may take, so a long name ellipsizes. */
  width: number;
  selected: boolean;
  interacted: boolean;
  held: boolean;
  /** This label holds the frames' one tab stop. */
  tabStop: boolean;
  onHold: (frame: CanvasFrame, handle: FrameHandle, event: PointerEvent<HTMLElement>) => void;
  onPick: (frame: CanvasFrame, additive: boolean) => void;
  onInteract: (frame: CanvasFrame) => void;
  onEnter: (frame: CanvasFrame) => void;
  onFocusLabel: (frame: CanvasFrame) => void;
}) {
  return (
    <div
      data-frame-header
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-pressed={selected}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
      title="Arrows move between frames; ⌥ and an arrow nudge it, ⇧ for ten"
      className="canvas-frame-label canvas-chrome"
      style={{ cursor: held ? 'grabbing' : 'grab', width: Math.max(0, width) }}
      onFocus={() => {
        onFocusLabel(frame);
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
      // The keyboard's route to spec §4's click: Enter does what the board's
      // mode makes of one, while Space toggles the frame in a multiple selection.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === ' ') onPick(frame, true);
        else onEnter(frame);
      }}
    >
      <span className="canvas-frame-name">{frame.name}</span>
      {interacted && <span className="canvas-frame-note">Interacting</span>}
    </div>
  );
}
