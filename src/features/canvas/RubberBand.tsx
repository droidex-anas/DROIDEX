import type { Band } from './useBoardGestures';

/** The rubber band, drawn in screen space above the board's world layer. */
export function RubberBand({ band: { origin, current } }: { band: Band }) {
  return (
    <div
      aria-hidden
      className="canvas-band"
      style={{
        left: Math.min(origin.x, current.x),
        top: Math.min(origin.y, current.y),
        width: Math.abs(current.x - origin.x),
        height: Math.abs(current.y - origin.y),
      }}
    />
  );
}
