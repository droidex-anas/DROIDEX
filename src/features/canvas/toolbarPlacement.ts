// Where the selected frame's toolbar stands. Above the frame's label is its
// place; when that would leave the board or cover another frame, it ends where
// the frame ends, then drops below the frame's size. It is never over the
// frame's own sheet, so it never hides the design it acts on.

import { canvasToScreen, type PlacedFrame, type Point, type Viewport } from './canvasGeometry';
import type { FrameRect } from './protocol';

/**
 * Screen pixels between the frame's edge and the bar: the label's row above,
 * the size's below, and the wrapper's padding (`.canvas-frame-tools` in
 * canvasBoardTools.css).
 */
const TOOLBAR_GAP_PX = 38;
/** How far another frame's label stands above it, which the bar keeps clear of too. */
const LABEL_PX = 24;

export interface ToolbarRoom {
  /** The frame's box, in screen pixels on the board. */
  frame: FrameRect;
  /** Every other frame's box, in screen pixels on the board. */
  others: FrameRect[];
  /** The part of the board no panel covers. */
  board: Point;
}

export interface ToolbarPlacement {
  side: 'above' | 'below';
  align: 'start' | 'end';
}

const PREFERENCE: readonly ToolbarPlacement[] = [
  { side: 'above', align: 'start' },
  { side: 'above', align: 'end' },
  { side: 'below', align: 'start' },
  { side: 'below', align: 'end' },
];

/** What `placeToolbar` weighs for one frame, from where the board draws every frame. */
export function toolbarRoom(
  viewport: Viewport,
  drawn: readonly PlacedFrame[],
  designId: string,
  board: Point,
): ToolbarRoom {
  const onScreen = (rect: FrameRect): FrameRect => {
    const corner = canvasToScreen(viewport, rect);
    return {
      x: corner.x,
      y: corner.y,
      width: rect.width * viewport.scale,
      height: rect.height * viewport.scale,
    };
  };
  const frame = drawn.find((placed) => placed.designId === designId);
  return {
    frame: onScreen(frame?.rect ?? { x: 0, y: 0, width: 0, height: 0 }),
    others: drawn
      .filter((placed) => placed.designId !== designId)
      .map(({ rect }) => onScreen(rect)),
    board,
  };
}

/**
 * The first place, in order of preference, that is on the board and clear of
 * the other frames; else the first one on the board; else above, ending where
 * the frame does once the board would cut the bar off on the right.
 */
export function placeToolbar(room: ToolbarRoom, bar: Point): ToolbarPlacement {
  const onBoard = PREFERENCE.filter((placement) =>
    inside(barBox(room.frame, bar, placement), room.board),
  );
  const clear = onBoard.find((placement) => {
    const box = barBox(room.frame, bar, placement);
    return !room.others.some((other) => overlaps(box, withLabel(other)));
  });
  return (
    clear ??
    onBoard.at(0) ?? {
      side: 'above',
      align: room.frame.x + bar.x <= room.board.x ? 'start' : 'end',
    }
  );
}

function barBox(frame: FrameRect, bar: Point, { side, align }: ToolbarPlacement): FrameRect {
  return {
    x: align === 'start' ? frame.x : frame.x + frame.width - bar.x,
    y:
      side === 'above' ? frame.y - TOOLBAR_GAP_PX - bar.y : frame.y + frame.height + TOOLBAR_GAP_PX,
    width: bar.x,
    height: bar.y,
  };
}

function withLabel(rect: FrameRect): FrameRect {
  return { ...rect, y: rect.y - LABEL_PX, height: rect.height + LABEL_PX };
}

function inside(box: FrameRect, board: Point): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= board.x && box.y + box.height <= board.y;
}

function overlaps(a: FrameRect, b: FrameRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
