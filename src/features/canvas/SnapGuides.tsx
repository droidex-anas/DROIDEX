import { canvasToScreen, type Viewport } from './canvasGeometry';
import type { SnapGap, SnapGuide, SnapMarks } from './frameSnap';
import { distanceLabel } from './measureDistances';
import { useScreenSize } from './useScreenSize';

/** Screen pixels a centred distance keeps clear of the line's end ticks. */
const TICK_CLEARANCE_PX = 4;

/**
 * The lines a snapped drag lined up on and the spaces it measured, or the
 * distances Alt measures under the pointer, drawn in screen space above the
 * board's world layer so they stay hairlines at any zoom.
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
      {marks.gaps.map((gap, index) => (
        // Kept mounted while the gaps follow the pointer, so each distance is measured once.
        <GapMark key={index} gap={gap} viewport={viewport} />
      ))}
    </div>
  );
}

/**
 * A measured space: a line with end ticks, and its distance centred on it, or
 * beside it when the line is too short to hold the distance clear of its ticks.
 */
function GapMark({ gap, viewport }: { gap: SnapGap; viewport: Viewport }) {
  const box = gapBox(gap, viewport);
  const [pill, pillSize] = useScreenSize();
  const length = gap.axis === 'x' ? box.width : box.height;
  const pillLength = gap.axis === 'x' ? pillSize.width : pillSize.height;
  return (
    <>
      <span className="canvas-snap-gap" data-axis={gap.axis} style={box} />
      <span
        ref={pill}
        className="canvas-snap-pill"
        data-axis={gap.axis}
        data-beside={length < pillLength + 2 * TICK_CLEARANCE_PX || undefined}
        style={{
          left: box.left + box.width / 2,
          top: box.top + box.height / 2,
        }}
      >
        {distanceLabel(gap.to - gap.from)}
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
