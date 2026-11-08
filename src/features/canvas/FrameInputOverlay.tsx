// The transparent layer over a frame's guest while the board owns the pointer
// (spec §4), and what a press on the design means in each mode: Select picks
// and drags the frame, Edit picks the element under the press, and Design
// points the chat's next prompt at the element a click lands on or the text a
// drag spans. Interact has no overlay, so the guest takes the pointer itself.

import { useRef, type MouseEvent, type PointerEvent } from 'react';
import type { Point } from './canvasGeometry';
import { picksElements } from './canvasState';
import type { DesignFrameProps } from './DesignFrame';
import type { PreviewProbe } from './previewDocument';
import type { CanvasFrame } from './protocol';

type OverlayProps = Pick<
  DesignFrameProps,
  | 'frame'
  | 'scale'
  | 'mode'
  | 'held'
  | 'elementHovered'
  | 'onPick'
  | 'onInteract'
  | 'onPickElement'
  | 'onDesignPick'
  | 'onHoverElement'
  | 'onEditEnter'
> & {
  /** A press that picks the frame and starts dragging it, as on its label. */
  press: (event: PointerEvent<HTMLElement>) => void;
  click: (event: MouseEvent<HTMLElement>) => void;
};

export function FrameInputOverlay({
  frame,
  scale,
  mode,
  held,
  elementHovered,
  onPick,
  onInteract,
  onPickElement,
  onDesignPick,
  onHoverElement,
  onEditEnter,
  press,
  click,
}: OverlayProps) {
  /** Where a press in Design went down, until it is released. */
  const designPress = useRef<Point | null>(null);
  const onElements = picksElements(mode);
  /** Where the pointer is in the design's own pixels. */
  const designPoint = (event: PointerEvent<HTMLElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
  };
  let cursor = 'default';
  if (held) cursor = 'grabbing';
  else if (onElements && elementHovered) cursor = 'pointer';
  return (
    <div
      data-canvas-input-overlay
      className="absolute inset-0"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (mode === 'design') {
          // Held, so a drag across text keeps reporting past the frame's edge.
          event.currentTarget.setPointerCapture(event.pointerId);
          designPress.current = designPoint(event);
          return;
        }
        if (mode === 'edit') {
          onPick(frame, false);
          onPickElement(frame, designPoint(event));
          return;
        }
        press(event);
      }}
      onPointerUp={(event) => {
        const from = designPress.current;
        designPress.current = null;
        if (mode === 'design' && from)
          onDesignPick(frame, designProbe(frame, from, designPoint(event), scale), event.shiftKey);
      }}
      onPointerCancel={() => {
        designPress.current = null;
      }}
      onPointerMove={(event) => {
        if (onElements) onHoverElement(frame, designPoint(event));
      }}
      onPointerLeave={() => {
        if (onElements) onHoverElement(frame, null);
      }}
      // Design points the prompt at elements and leaves the frame selection alone.
      onClick={mode === 'design' ? undefined : click}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (mode === 'select') onInteract(frame);
        else if (mode === 'edit') onEditEnter(frame);
      }}
    />
  );
}

/** Screen pixels a press travels before it is a drag across text rather than a click. */
const DRAG_PX = 4;

/**
 * What a released press in Design asks the preview: a click, about the element
 * under it; a drag, about the text between its ends, kept inside the frame.
 */
function designProbe(
  frame: Pick<CanvasFrame, 'rect'>,
  from: Point,
  to: Point,
  scale: number,
): PreviewProbe {
  if (Math.hypot(to.x - from.x, to.y - from.y) * scale < DRAG_PX) return { at: from };
  const inside = ({ x, y }: Point): Point => ({
    x: Math.min(Math.max(x, 0), frame.rect.width - 1),
    y: Math.min(Math.max(y, 0), frame.rect.height - 1),
  });
  return { from: inside(from), to: inside(to) };
}
