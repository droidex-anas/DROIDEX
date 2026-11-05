import { boundsOf, type PlacedFrame } from './canvasGeometry';

/**
 * The box around a selection of several frames and their combined size under
 * it, as one frame shows its own. It sits in the world layer, so it follows
 * the frames through a drag.
 */
export function SelectionBounds({
  drawn,
  selectedFrameIds,
}: {
  drawn: readonly PlacedFrame[];
  selectedFrameIds: readonly string[];
}) {
  if (selectedFrameIds.length < 2) return null;
  const bounds = boundsOf(
    drawn.filter(({ designId }) => selectedFrameIds.includes(designId)).map(({ rect }) => rect),
  );
  if (bounds === null) return null;
  return (
    <div
      aria-hidden
      className="canvas-selection-bounds"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      <div className="canvas-frame-size canvas-chrome">
        <span>
          {Math.round(bounds.width)} × {Math.round(bounds.height)}
        </span>
      </div>
    </div>
  );
}
