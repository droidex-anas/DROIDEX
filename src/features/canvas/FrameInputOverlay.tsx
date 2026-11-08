// The transparent layer over a frame's guest while the board owns the pointer
// (spec §4), and what a press on the design means in each mode: Select picks
// and drags the frame, Edit picks the element under the press, and Design
// points the chat's next prompt at the element a click lands on or the text a
// drag spans. Interact has no overlay, so the guest takes the pointer itself.

import { useRef, type MouseEvent, type PointerEvent } from 'react';
import type { Point } from './canvasGeometry';
import { picksElements } from './canvasState';
import type { DesignFrameProps } from './DesignFrame';
import type { PreviewTextRange } from './previewDocument';
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
  | 'onDesignDrag'
  | 'onHoverElement'
  | 'onEditEnter'
> & {
  /** A press that picks the frame and starts dragging it, as on its label. */
  press: (event: PointerEvent<HTMLElement>) => void;
  click: (event: MouseEvent<HTMLElement>) => void;
};

/** Screen pixels a press travels before it is a drag across text rather than a click. */
const DRAG_PX = 4;

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
  onDesignDrag,
  onHoverElement,
  onEditEnter,
  press,
  click,
}: OverlayProps) {
  /** Where a press in Design went down, and whether it has become a drag, until it is released. */
  const designPress = useRef<{ from: Point; dragging: boolean } | null>(null);
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
          designPress.current = { from: designPoint(event), dragging: false };
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
        const pressed = designPress.current;
        designPress.current = null;
        if (mode !== 'design' || !pressed) return;
        const probe = pressed.dragging
          ? textRange(frame, pressed.from, designPoint(event))
          : { at: pressed.from };
        onDesignPick(frame, probe, event.shiftKey);
      }}
      onPointerCancel={() => {
        if (designPress.current?.dragging) onDesignDrag(frame, null);
        designPress.current = null;
      }}
      onPointerMove={(event) => {
        const pressed = designPress.current;
        if (mode === 'design' && pressed) {
          const to = designPoint(event);
          const travelled = Math.hypot(to.x - pressed.from.x, to.y - pressed.from.y) * scale;
          if (!pressed.dragging && travelled < DRAG_PX) return;
          // A drag across text names no element under the pointer.
          if (!pressed.dragging) onHoverElement(frame, null);
          pressed.dragging = true;
          onDesignDrag(frame, textRange(frame, pressed.from, to));
          return;
        }
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

/** The text between a drag's ends, kept inside the frame. */
function textRange(frame: Pick<CanvasFrame, 'rect'>, from: Point, to: Point): PreviewTextRange {
  const inside = ({ x, y }: Point): Point => ({
    x: Math.min(Math.max(x, 0), frame.rect.width - 1),
    y: Math.min(Math.max(y, 0), frame.rect.height - 1),
  });
  return { from: inside(from), to: inside(to) };
}
