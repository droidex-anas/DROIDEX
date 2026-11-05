import type { PointerEvent } from 'react';
import type { FrameHandle } from './canvasGeometry';
import type { BoardMode } from './canvasState';
import type { CanvasFrame, FrameRect } from './protocol';

/**
 * A frame selected on its own: its size under it, unless Edit is measuring an
 * element instead, and in Select the handles that resize it.
 */
export function FrameSizing({
  frame,
  rect,
  mode,
  elementPicked,
  onHold,
}: {
  frame: CanvasFrame;
  rect: FrameRect;
  mode: BoardMode;
  elementPicked: boolean;
  onHold: (frame: CanvasFrame, handle: FrameHandle, event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <>
      {!elementPicked && (
        <div className="canvas-frame-size canvas-chrome">
          <span>
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      )}
      {mode === 'select' &&
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
    </>
  );
}
