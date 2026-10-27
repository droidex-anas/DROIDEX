// A frame's name above its sheet, and the handle that drags it in either mode
// (spec §4). It sits outside the Select overlay, so a drag is always available
// even while the preview owns the pointer.
//
// It is also the keyboard's way onto the board. The labels share one tab stop,
// the frame focus last rested on, and the board moves focus between them with
// the arrows, Home and End in reading order.

import { useEffect, useRef, useState, type PointerEvent, type Ref } from 'react';
import { toast } from '../../lib/toast';
import type { FrameHandle } from './canvasGeometry';
import { canvasMessage } from './client';
import type { CanvasFrame } from './protocol';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

export function FrameLabel({
  ref,
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
  ref: Ref<HTMLDivElement>;
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
      ref={ref}
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

/**
 * The label while the frame is renamed. Enter or leaving the field saves the
 * name against the frame as it was when renaming began; Escape keeps the old one.
 */
export function FrameNameField({
  frame,
  width,
  onRename,
  onDone,
}: {
  frame: CanvasFrame;
  width: number;
  onRename: (frame: CanvasFrame, name: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [renamed] = useState(frame);
  const [name, setName] = useState(frame.name);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    field.current?.select();
  }, []);

  const finish = () => {
    finished.current = true;
    onDone();
  };
  const save = async () => {
    if (pending || finished.current) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === renamed.name) {
      finish();
      return;
    }
    setPending(true);
    try {
      await onRename(renamed, trimmed);
      finish();
    } catch (error) {
      toast.error(canvasMessage(error));
      setPending(false);
      field.current?.focus();
    }
  };

  return (
    <div className="canvas-frame-label canvas-chrome" style={{ width: Math.max(0, width) }}>
      <input
        ref={field}
        aria-label={`Name of ${renamed.name}`}
        value={name}
        maxLength={MAX_FRAME_NAME_LENGTH}
        readOnly={pending}
        aria-busy={pending}
        autoFocus
        spellCheck={false}
        className="canvas-frame-name canvas-frame-name-field"
        onChange={(event) => {
          setName(event.target.value);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          } else if (event.key === 'Escape' && !pending) {
            event.preventDefault();
            event.stopPropagation();
            finish();
          }
        }}
        onBlur={() => {
          void save();
        }}
      />
    </div>
  );
}
