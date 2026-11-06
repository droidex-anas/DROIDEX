// Edit's outlines on the board: the element under the pointer, named by its
// tag, and the picked one, with its size. They are drawn in the world layer
// after the frames rather than inside a design or its sheet, so pan, zoom and
// a frame's move or resize carry them at once, and a chip at the sheet's edge
// is not cut off. Each box is trimmed to its frame, where the design is
// visible, and glides when the element's own box changes.

import type { ReactNode } from 'react';
import type { PlacedFrame } from './canvasGeometry';
import type { FrameRect } from './protocol';
import type { HoveredElement } from './useElementHover';
import type { ElementSelection } from './useElementEditor';

export function ElementOutlines({
  drawn,
  selection,
  hovered,
}: {
  /** Where the board draws each frame. */
  drawn: PlacedFrame[];
  selection: ElementSelection | null;
  hovered: HoveredElement | null;
}) {
  const picked = selection?.draft.element;
  const selected = selection && picked && onBoard(drawn, picked.designId, selection.shown.rect);
  // The picked element's own outline already says where it is.
  const hoverIsPicked =
    picked?.designId === hovered?.designId &&
    picked?.elementId === hovered?.element.elementId &&
    picked?.instancePath === hovered?.element.instancePath;
  const hover = hovered && !hoverIsPicked && onBoard(drawn, hovered.designId, hovered.element.rect);
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
            <div className="canvas-element-tag canvas-chrome">
              <span>{hovered.element.tagName}</span>
            </div>
          </div>
        </AtFrame>
      )}
      {selection && selected && (
        <AtFrame frame={selected.frame}>
          <div aria-hidden className="canvas-element-outline" style={selected.box}>
            <div className="canvas-frame-size canvas-chrome">
              <span>
                {Math.round(selection.shown.rect.width)} × {Math.round(selection.shown.rect.height)}
              </span>
            </div>
          </div>
        </AtFrame>
      )}
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
function onBoard(drawn: PlacedFrame[], designId: string, element: FrameRect) {
  const frame = drawn.find((placed) => placed.designId === designId)?.rect;
  const box = frame && inFrame(frame, element);
  return frame && box ? { frame, box } : null;
}

/** An element's box inside its frame, trimmed to it; null when none of it is visible. */
function inFrame(frame: FrameRect, element: FrameRect) {
  const left = Math.max(element.x, 0);
  const top = Math.max(element.y, 0);
  const right = Math.min(element.x + element.width, frame.width);
  const bottom = Math.min(element.y + element.height, frame.height);
  if (right < left || bottom < top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
