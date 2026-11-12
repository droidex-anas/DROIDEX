// Edit's and Design's outlines on the board: the element under the pointer,
// named by its tag (and in Design its component), Edit's picked one with its
// size, and the elements and text Design picked or is being dragged across.
// They are drawn in the world layer
// after the frames rather than inside a design or its sheet, so pan and zoom
// carry them at once, a held frame's move takes them along (HeldFrames), and a
// chip at the sheet's edge is not cut off. Each box is trimmed to its frame,
// where the design is visible, and glides when the element's own box changes.
// Only this layer reads the hovered element, so a hover renders nothing else.

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { PlacedFrame } from './canvasGeometry';
import { onBoard, type Box, type PickedOnBoard } from './elementOnBoard';
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
              data-side={tagSide(
                shown.box,
                shown.frame.height,
                { width: tagOnScreen.width / scale, height: TAG_HEIGHT_PX / scale },
                hovered.element.room,
                sizeChip,
              )}
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
            <div className="canvas-frame-size canvas-chrome">
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

/**
 * One outline, placed by `transform`. When its box changes it glides there by
 * transform alone: the box slides from where it was, and its line, drawn by
 * `::before`, scales from the size it had. Each glide adds to any still
 * running, so a box that changes mid-glide carries on from where it is shown.
 */
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
  // Whole pixels, as left and top were laid out, so its line is not smeared across two.
  const left = Math.round(box.left);
  const top = Math.round(box.top);
  const { width, height } = box;
  useLayoutEffect(() => {
    const from = last.current;
    const to = { left, top, width, height };
    last.current = to;
    if (node.current && from && glides) glide(node.current, from, to);
  }, [glides, left, top, width, height]);
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

function glide(element: HTMLElement, from: Box, to: Box) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const timing = { ...glideTiming(), composite: 'add' as const };
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (dx !== 0 || dy !== 0)
    element.animate(
      [{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }],
      timing,
    );
  if (to.width === 0 || to.height === 0) return;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  if (sx !== 1 || sy !== 1)
    element.animate([{ transform: `scale(${String(sx)}, ${String(sy)})` }, { transform: 'none' }], {
      ...timing,
      pseudoElement: '::before',
    });
}

let timingTokens: { duration: number; easing: string } | null = null;

/** The quick duration and smooth easing tokens, read once: they never change while the app runs. */
function glideTiming(): { duration: number; easing: string } {
  if (timingTokens) return timingTokens;
  const tokens = getComputedStyle(document.documentElement);
  // The duration token is written in milliseconds.
  timingTokens = {
    duration: parseFloat(tokens.getPropertyValue('--duration-quick')),
    easing: tokens.getPropertyValue('--ease-smooth-out').trim(),
  };
  return timingTokens;
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
