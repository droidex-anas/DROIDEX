// Edit's and Design's outlines on the board: the element under the pointer,
// named by its tag (and in Design its component), Edit's picked one with its
// size, and the elements and text Design picked or is being dragged across.
// They are drawn in the world layer
// after the frames rather than inside a design or its sheet, so pan, zoom and
// a frame's move or resize carry them at once, and a chip at the sheet's edge
// is not cut off. Each box is trimmed to its frame, where the design is
// visible, and glides when the element's own box changes.

import type { ReactNode } from 'react';
import type { PlacedFrame } from './canvasGeometry';
import { isDrawn, type PreviewHover } from './previewDocument';
import type { FrameRect } from './protocol';
import { isPicked, type HoveredElement } from './useElementHover';
import type { ElementSelection } from './useElementEditor';
import { useScreenSize } from './useScreenSize';

/** On screen: the tag's line, flush on the element, and the size chip's gap and line. */
const TAG_HEIGHT_PX = 14;
export const SIZE_ROOM_PX = 26;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

type TagSide = 'above' | 'below' | 'inside';

/** Where Edit's picked element shows: its frame, and its box there trimmed to the frame. */
export interface PickedOnBoard {
  selection: ElementSelection;
  frame: FrameRect;
  box: Box;
}

/** Null when the picked element is hidden, or none of it shows in its frame. */
export function pickedOnBoard(
  drawn: readonly PlacedFrame[],
  selection: ElementSelection | null,
): PickedOnBoard | null {
  // A hidden element has no box to outline; the panel says it is hidden.
  if (!selection || !isDrawn(selection.shown.rect)) return null;
  const shown = onBoard(drawn, selection.draft.element.designId, selection.shown.rect);
  return shown && { selection, ...shown };
}

/** A box Design outlines in a frame: a pick, or the text a press is dragging across. */
export interface PickOutline {
  key: string;
  designId: string;
  box: FrameRect;
  dragging: boolean;
}

export function ElementOutlines({
  drawn,
  scale,
  selected,
  hovered,
  hoveredComponent,
  picks,
}: {
  /** Where the board draws each frame. */
  drawn: PlacedFrame[];
  /** The board's zoom, which sizes the screen-sized chips in frame units. */
  scale: number;
  /** Where Edit's picked element shows, which its outline and size chip are drawn from. */
  selected: PickedOnBoard | null;
  hovered: HoveredElement | null;
  /** The component the hovered element is written in, which Design names before its tag. */
  hoveredComponent: string | null;
  /** Design's picks, outlined where each was picked, and the text being dragged across. */
  picks: readonly PickOutline[];
}) {
  const [tag, tagOnScreen] = useScreenSize();
  const [size, sizeOnScreen] = useScreenSize();
  const picked = selected?.selection.draft.element;
  // The picked element's own outline already says where it is.
  const hover =
    hovered &&
    !(picked && isPicked(picked, hovered)) &&
    onBoard(drawn, hovered.designId, hovered.element.rect);
  const sizeChip =
    selected && picked?.designId === hovered?.designId
      ? sizeChipOf(selected.box, sizeOnScreen.width / scale, scale)
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
              data-side={tagSide(
                hover.box,
                hover.frame.height,
                { width: tagOnScreen.width / scale, height: TAG_HEIGHT_PX / scale },
                hovered.element.room,
                sizeChip,
              )}
            >
              <span ref={tag}>
                <TagName tagName={hovered.element.tagName} component={hoveredComponent} />
              </span>
            </div>
          </div>
        </AtFrame>
      )}
      {selected && (
        <AtFrame frame={selected.frame}>
          <div aria-hidden className="canvas-element-outline" style={selected.box}>
            <div className="canvas-frame-size canvas-chrome">
              <span ref={size}>
                {Math.round(selected.selection.shown.rect.width)} ×{' '}
                {Math.round(selected.selection.shown.rect.height)}
              </span>
            </div>
          </div>
        </AtFrame>
      )}
      {picks.map((pick) => {
        const shown = onBoard(drawn, pick.designId, pick.box);
        return (
          shown && (
            <AtFrame key={pick.key} frame={shown.frame}>
              <div
                aria-hidden
                data-design-pick
                data-dragging={pick.dragging || undefined}
                className="canvas-element-outline"
                style={shown.box}
              />
            </AtFrame>
          )
        );
      })}
    </>
  );
}

function TagName({ tagName, component }: { tagName: string; component: string | null }) {
  if (!component) return tagName;
  return (
    <>
      {component}
      <span className="canvas-element-tag-detail">{tagName}</span>
    </>
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
function onBoard(drawn: readonly PlacedFrame[], designId: string, element: FrameRect) {
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
 * Where the hovered element's tag goes, flush on its box and off the element
 * where it can: above, as a layer's name sits; below when above would cover
 * other content, leave the frame onto its own chrome, or meet the picked
 * element's size chip; in the box's own corner when neither side has room,
 * where it covers only the element it names.
 */
function tagSide(
  box: Box,
  frameHeight: number,
  tag: { width: number; height: number },
  room: PreviewHover['room'],
  sizeChip: Box | null,
): TagSide {
  const fits = (top: number, free: number | null) =>
    (free === null || free >= tag.height) &&
    top >= 0 &&
    top + tag.height <= frameHeight &&
    !(sizeChip && overlaps({ left: box.left, top, ...tag }, sizeChip));
  if (fits(box.top - tag.height, room.above)) return 'above';
  if (fits(box.top + box.height, room.below)) return 'below';
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
