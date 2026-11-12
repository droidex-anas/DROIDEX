// Edit's and Design's outlines on the board: the element under the pointer,
// named by its tag (and in Design its component), Edit's picked one with its
// size, and the elements and text Design picked or is being dragged across.
// They are drawn in the world layer
// after the frames rather than inside a design or its sheet, so pan and zoom
// carry them at once, a held frame's move takes them along (HeldFrames), and a
// chip at the sheet's edge is not cut off. Each box is trimmed to its frame,
// where the design is visible, and glides when the element's own box changes.
// The hovered element is read from its store here, so a hover renders this
// layer and not the board.

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PlacedFrame } from './canvasGeometry';
import { onBoard, type Box, type PickedOnBoard } from './elementOnBoard';
import { OutlineGlide, type GlideAnchor } from './outlineGlide';
import type { OverlayStore } from './overlayStore';
import type { PreviewHover } from './previewDocument';
import type { FrameRect } from './protocol';
import { isPicked, type HoveredElement } from './useElementHover';
import { useScreenSize } from './useScreenSize';

/** On screen: the tag's line, flush on the element, and the size chip's gap and line. */
const TAG_HEIGHT_PX = 14;
export const SIZE_ROOM_PX = 26;

type TagSide = 'above' | 'below' | 'inside';

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
  hovered: hover,
  componentOf,
  picks,
}: {
  /** Where the board draws each frame. */
  drawn: PlacedFrame[];
  /** The board's zoom, which sizes the screen-sized chips in frame units. */
  scale: number;
  /** Where Edit's picked element shows, which its outline and size chip are drawn from. */
  selected: PickedOnBoard | null;
  hovered: OverlayStore<HoveredElement | null>;
  /** The component an element is written in, which Design names before its tag. */
  componentOf: (hovered: HoveredElement) => string | null;
  /** Design's picks, outlined where each was picked, and the text being dragged across. */
  picks: readonly PickOutline[];
}) {
  const hovered = useSyncExternalStore(hover.subscribe, hover.read, hover.read);
  const [tag, tagOnScreen] = useScreenSize();
  const [size, sizeOnScreen] = useScreenSize();
  const picked = selected?.selection.draft.element;
  // The picked element's own outline already says where it is.
  const shown =
    hovered &&
    !(picked && isPicked(picked, hovered)) &&
    onBoard(drawn, hovered.designId, hovered.element.rect);
  const sizeChip =
    selected && picked?.designId === hovered?.designId
      ? sizeChipOf(selected.box, sizeOnScreen.width / scale, scale)
      : null;
  const side =
    hovered && shown
      ? tagSide(
          shown.box,
          shown.frame.height,
          { width: tagOnScreen.width / scale, height: TAG_HEIGHT_PX / scale },
          hovered.element.room,
          sizeChip,
        )
      : null;
  return (
    <>
      {hovered && shown && (
        // A new frame is a new outline, so it never glides across the board.
        <AtFrame key={hovered.designId} designId={hovered.designId} frame={shown.frame}>
          <Outline
            box={shown.box}
            glides
            className="canvas-element-hover"
            data={{ 'data-element-hover': hovered.element.tagName }}
          >
            <div
              className="canvas-element-tag canvas-chrome"
              data-side={side}
              data-glide-anchor={side === 'below' ? ('bottom' satisfies GlideAnchor) : undefined}
            >
              <span ref={tag}>
                <TagName tagName={hovered.element.tagName} component={componentOf(hovered)} />
              </span>
            </div>
          </Outline>
        </AtFrame>
      )}
      {selected && (
        <AtFrame designId={selected.selection.draft.element.designId} frame={selected.frame}>
          <Outline box={selected.box} glides className="canvas-element-outline">
            <div
              className="canvas-frame-size canvas-chrome"
              data-glide-anchor={'bottom-centre' satisfies GlideAnchor}
            >
              <span ref={size}>
                {Math.round(selected.selection.shown.rect.width)} ×{' '}
                {Math.round(selected.selection.shown.rect.height)}
              </span>
            </div>
          </Outline>
        </AtFrame>
      )}
      {picks.map((pick) => {
        const placed = onBoard(drawn, pick.designId, pick.box);
        return (
          placed && (
            <AtFrame key={pick.key} designId={pick.designId} frame={placed.frame}>
              {/* Text being dragged across follows the pointer, so it never glides behind it. */}
              <Outline
                box={placed.box}
                glides={!pick.dragging}
                className="canvas-element-outline"
                data={{ 'data-design-pick': '', 'data-dragging': pick.dragging || undefined }}
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
function AtFrame({
  designId,
  frame,
  children,
}: {
  designId: string;
  frame: FrameRect;
  children: ReactNode;
}) {
  return (
    <div
      data-follows-frame={designId}
      className="absolute left-0 top-0"
      style={{ transform: `translate(${String(frame.x)}px, ${String(frame.y)}px)` }}
    >
      {children}
    </div>
  );
}

/** One outline, placed by `transform`, which glides when its box changes (OutlineGlide). */
function Outline({
  box,
  glides,
  className,
  data,
  children,
}: {
  box: Box;
  glides: boolean;
  className: string;
  /** Its `data-` attributes. */
  data?: Record<string, string | boolean | undefined>;
  children?: ReactNode;
}) {
  const node = useRef<HTMLDivElement>(null);
  const last = useRef<Box | null>(null);
  const [motion] = useState(() => new OutlineGlide());
  const { left, top, width, height } = box;
  useLayoutEffect(() => {
    const from = last.current;
    const to = { left, top, width, height };
    last.current = to;
    if (!node.current || !from) return;
    if (glides) motion.glide(node.current, from, to);
    else motion.stop();
  }, [glides, motion, left, top, width, height]);
  useLayoutEffect(
    () => () => {
      motion.stop();
    },
    [motion],
  );
  return (
    <div
      ref={node}
      aria-hidden
      className={className}
      style={{ transform: `translate(${String(left)}px, ${String(top)}px)`, width, height }}
      {...data}
    >
      {children}
    </div>
  );
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
