// Edit's outlines on the board: the element under the pointer, named by its
// tag, and the picked one, with its size. They are drawn in the world layer
// after the frames rather than inside a design or its sheet, so pan, zoom and
// a frame's move or resize carry them at once, and a chip at the sheet's edge
// is not cut off. Each box is trimmed to its frame, where the design is
// visible, and glides when the element's own box changes.

import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { PlacedFrame } from './canvasGeometry';
import type { ElementRef, FrameRect } from './protocol';
import type { HoveredElement } from './useElementHover';
import type { ElementSelection } from './useElementEditor';

/** On screen: the tag's line and its gap to the element, and the size chip's gap and line. */
const TAG_ROOM_PX = 19;
const SIZE_ROOM_PX = 26;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

type TagSide = 'above' | 'below' | 'inside';

export function ElementOutlines({
  drawn,
  scale,
  selection,
  hovered,
}: {
  /** Where the board draws each frame. */
  drawn: PlacedFrame[];
  /** The board's zoom, which sizes the screen-sized chips in frame units. */
  scale: number;
  selection: ElementSelection | null;
  hovered: HoveredElement | null;
}) {
  const [tag, tagWidth] = useScreenWidth();
  const [size, sizeWidth] = useScreenWidth();
  const picked = selection?.draft.element;
  const selected = selection && picked && onBoard(drawn, picked.designId, selection.shown.rect);
  // The picked element's own outline already says where it is.
  const hover =
    hovered &&
    !(picked && isPicked(picked, hovered)) &&
    onBoard(drawn, hovered.designId, hovered.element.rect);
  const sizeChip =
    selected && picked.designId === hovered?.designId
      ? sizeChipOf(selected.box, sizeWidth / scale, scale)
      : null;
  return (
    <>
      {hovered && hover && (
        // A new frame is a new outline, so it never glides across the board.
        <AtFrame key={hovered.designId} frame={hover.frame}>
          <div
            aria-hidden
            data-element-hover={hovered.element.tagName}
            className="canvas-element-hover"
            style={hover.box}
          >
            <div
              className="canvas-element-tag canvas-chrome"
              data-side={tagSide(hover.box, tagWidth / scale, hover.frame.height, sizeChip, scale)}
            >
              <span ref={tag}>{hovered.element.tagName}</span>
            </div>
          </div>
        </AtFrame>
      )}
      {selection && selected && (
        <AtFrame frame={selected.frame}>
          <div aria-hidden className="canvas-element-outline" style={selected.box}>
            <div className="canvas-frame-size canvas-chrome">
              <span ref={size}>
                {Math.round(selection.shown.rect.width)} × {Math.round(selection.shown.rect.height)}
              </span>
            </div>
          </div>
        </AtFrame>
      )}
    </>
  );
}

function isPicked(picked: ElementRef, hovered: HoveredElement): boolean {
  return (
    picked.designId === hovered.designId &&
    picked.elementId === hovered.element.elementId &&
    picked.instancePath === hovered.element.instancePath
  );
}

/** The frame's corner, which a dragged frame moves without the outline's glide. */
function AtFrame({ frame, children }: { frame: FrameRect; children: ReactNode }) {
  return (
    <div className="absolute" style={{ left: frame.x, top: frame.y }}>
      {children}
    </div>
  );
}

/** The frame an element is drawn in and its visible box there, if any of it shows. */
function onBoard(drawn: PlacedFrame[], designId: string, element: FrameRect) {
  const frame = drawn.find((placed) => placed.designId === designId)?.rect;
  const box = frame && inFrame(frame, element);
  return frame && box ? { frame, box } : null;
}

/**
 * An element's box inside its frame, trimmed to it; null when none of it is
 * visible, as when it only touches the frame's edge from outside. An element
 * with no width or height of its own still shows as a line.
 */
function inFrame(frame: FrameRect, element: FrameRect): Box | null {
  const left = Math.max(element.x, 0);
  const top = Math.max(element.y, 0);
  const width = Math.min(element.x + element.width, frame.width) - left;
  const height = Math.min(element.y + element.height, frame.height) - top;
  const trimmedAway = (shown: number, own: number) => shown < 0 || (shown === 0 && own > 0);
  if (trimmedAway(width, element.width) || trimmedAway(height, element.height)) return null;
  return { left, top, width, height };
}

/** A chip's width on screen, which its text sets, so it is read once the chip is drawn. */
function useScreenWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return undefined;
    const measure = () => {
      setWidth(element.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return [setElement, width] as const;
}

/** What a picked element's size chip covers: centred under its box, with the gap above it. */
function sizeChipOf(box: Box, width: number, scale: number): Box {
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + box.height,
    width,
    height: SIZE_ROOM_PX / scale,
  };
}

/**
 * Where the hovered element's tag goes, off the element itself where it can:
 * above its box, as a layer's name sits; below when above would leave the
 * frame, onto its own chrome, or meet the picked element's size chip; in the
 * box's corner when neither side has room.
 */
function tagSide(
  box: Box,
  width: number,
  frameHeight: number,
  sizeChip: Box | null,
  scale: number,
): TagSide {
  const room = TAG_ROOM_PX / scale;
  const fits = (top: number) =>
    top >= 0 &&
    top + room <= frameHeight &&
    !(sizeChip && overlaps({ left: box.left, top, width, height: room }, sizeChip));
  if (fits(box.top - room)) return 'above';
  if (fits(box.top + box.height)) return 'below';
  return 'inside';
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}
