// A frame selected on its own: its size under it, which opens the size menu in
// Select, and the handles on every edge and corner that resize it.

import { useRef, useState, type PointerEvent } from 'react';
import { ChevronDown } from '@droidex/icons';
import { frameSizeLabel, type FrameHandle, type ResizeHandle } from './canvasGeometry';
import type { BoardMode } from './canvasState';
import { FrameSizeMenu, type FrameSize } from './FrameSizeMenu';
import type { CanvasFrame, FrameRect } from './protocol';

/** Edges first, so the corner squares sit above the strips they overlap. */
const HANDLES: readonly ResizeHandle[] = [
  'north',
  'south',
  'east',
  'west',
  'northwest',
  'northeast',
  'southwest',
  'southeast',
];

const CORNERS: ReadonlySet<ResizeHandle> = new Set([
  'northwest',
  'northeast',
  'southwest',
  'southeast',
]);

export function FrameSizing({
  frame,
  rect,
  mode,
  elementPicked,
  onHold,
  onResize,
  onLeave,
}: {
  frame: CanvasFrame;
  rect: FrameRect;
  mode: BoardMode;
  /** Edit is measuring an element instead, under its own outline. */
  elementPicked: boolean;
  onHold: (frame: CanvasFrame, handle: FrameHandle, event: PointerEvent<HTMLElement>) => void;
  onResize: (frame: CanvasFrame, size: FrameSize) => void;
  /** Hands the keyboard back to the frame's label. */
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const size = frameSizeLabel(rect);
  const resizable = mode === 'select';
  return (
    <>
      {!elementPicked && (
        <div
          className="canvas-frame-size canvas-chrome"
          // The menu portals out, but React still bubbles its presses through
          // here; a press that reached the board would pan and eat the click.
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          {resizable ? (
            <>
              <button
                ref={trigger}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`Size ${size}`}
                title="Set size"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  onLeave();
                }}
                onClick={() => {
                  setOpen((current) => !current);
                }}
              >
                {/* A held frame's resize redraws this text outside React. */}
                <span data-frame-size-text>{size}</span>
                <ChevronDown className="h-3 w-3" aria-hidden />
              </button>
              <FrameSizeMenu
                open={open}
                onClose={() => {
                  setOpen(false);
                }}
                anchorRef={trigger}
                rect={rect}
                onResize={(next) => {
                  onResize(frame, next);
                }}
              />
            </>
          ) : (
            <span data-frame-size-text>{size}</span>
          )}
        </div>
      )}
      {resizable &&
        HANDLES.map((handle) => (
          <span
            key={handle}
            role="presentation"
            aria-hidden
            data-handle={handle}
            className={`canvas-frame-handle ${CORNERS.has(handle) ? 'canvas-frame-corner' : ''}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onHold(frame, handle, event);
            }}
          />
        ))}
    </>
  );
}
