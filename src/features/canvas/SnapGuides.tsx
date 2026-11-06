import { canvasToScreen, type Viewport } from './canvasGeometry';
import type { SnapGap, SnapGuide, SnapMarks } from './frameSnap';

/**
 * The lines a snapped drag lined up on and the spaces it measured, drawn in
 * screen space above the board's world layer so they stay hairlines at any zoom.
 */
export function SnapGuides({ marks, viewport }: { marks: SnapMarks; viewport: Viewport }) {
  if (marks.guides.length === 0 && marks.gaps.length === 0) return null;
  return (
    <div aria-hidden className="canvas-snap">
      {marks.guides.map((guide) => (
        <span
          key={`${guide.axis}:${String(guide.at)}`}
          className="canvas-snap-line"
          style={guideBox(guide, viewport)}
        />
      ))}
      {marks.gaps.map((gap) => (
        <GapMark
          key={`${gap.axis}:${String(gap.from)}:${String(gap.to)}`}
          gap={gap}
          viewport={viewport}
        />
      ))}
    </div>
  );
}

/** A space between two frames: a measured line with end ticks, and its distance. */
function GapMark({ gap, viewport }: { gap: SnapGap; viewport: Viewport }) {
  const box = gapBox(gap, viewport);
  return (
    <>
      <span className="canvas-snap-gap" data-axis={gap.axis} style={box} />
      <span
        className="canvas-snap-pill"
        style={{
          left: box.left + box.width / 2,
          top: box.top + box.height / 2,
        }}
      >
        {Math.round(gap.to - gap.from)}
      </span>
    </>
  );
}

/** A one-pixel line from `from` to `to` along `along`, at `at` across it, in whole screen pixels. */
function lineBox(along: 'x' | 'y', from: number, to: number, at: number, viewport: Viewport) {
  const start = canvasToScreen(viewport, along === 'x' ? { x: from, y: at } : { x: at, y: from });
  const end = canvasToScreen(viewport, along === 'x' ? { x: to, y: at } : { x: at, y: to });
  const left = Math.round(start.x);
  const top = Math.round(start.y);
  return {
    left,
    top,
    width: along === 'x' ? Math.round(end.x) - left : 1,
    height: along === 'y' ? Math.round(end.y) - top : 1,
  };
}

/** A guide on x is a vertical line at that x, so it runs along y. */
function guideBox(guide: SnapGuide, viewport: Viewport) {
  return lineBox(guide.axis === 'x' ? 'y' : 'x', guide.from, guide.to, guide.at, viewport);
}

function gapBox(gap: SnapGap, viewport: Viewport) {
  return lineBox(gap.axis, gap.from, gap.to, gap.at, viewport);
}
