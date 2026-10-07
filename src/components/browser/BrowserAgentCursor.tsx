import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { onNativeBrowserAgentPoint } from '../../lib/nativeBrowser';
import design from './browserAgentCursorDesign.json';

const ARTWORK = design.styles.droidex;
// The artwork's glow, with a soft contact shadow under it so the pale glyph
// still has an edge on a white page.
const GLYPH_FILTER = `${ARTWORK.overlayFilter} drop-shadow(0 1px 1.5px rgba(16, 32, 90, 0.45))`;
// The glyph's tip, where the agent points, as a share of the artwork's box.
const TIP = {
  x: design.hotspot.x / design.viewBoxSize,
  y: design.hotspot.y / design.viewBoxSize,
};
const TIP_ORIGIN = `${String(TIP.x * 100)}% ${String(TIP.y * 100)}%`;
// The room the step's chip takes beside the glyph, so it turns to the other
// side near the page's right or bottom edge rather than being cut off.
const CHIP_ROOM = { x: 190, y: 64 };
// The working line's word for a click (lib/browserTools), which lands with a press.
const CLICKING = 'Clicking';
// Points along the arc; the glide is straight between them.
const GLIDE_FRAMES = 8;
const RING_EASING = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

interface Point {
  x: number;
  y: number;
}

/**
 * The agent's cursor over a page, in the pane or on the picture in the
 * transcript's Browser card. It shows while an agent's turn uses the page,
 * resting where it last pointed (or near the middle before it has pointed)
 * and drifting a little while the model thinks. A new point is reached on a
 * gentle arc, eased in and out; a click lands with a press and a soft ring.
 * Beside it a chip names the step in the working line's words. When the turn
 * ends it lingers a moment and fades. The app draws it above the page, so it
 * is never part of the page or of the agent's screenshots, and input never
 * waits for it. It draws only while shown, and takes the agent's points only
 * then, or always when it is to `follow` them.
 */
export function BrowserAgentCursor({
  browserSessionId,
  scale,
  shown,
  present,
  step = null,
  named = false,
  follow = false,
  rest,
  size = design.size.default,
}: {
  browserSessionId: string;
  /** How large the page is drawn. */
  scale: number;
  shown: boolean;
  /** An agent's turn is using the page. */
  present: boolean;
  /** The step in flight in the working line's words ("Clicking"), if any. */
  step?: string | null;
  /** Shows the step in a chip beside the cursor. */
  named?: boolean;
  /** Keeps up with the agent's points while not shown, to be in place when it is. */
  follow?: boolean;
  /** Where it waits before the agent first points, in the page's pixels. */
  rest?: Point;
  /** The glyph's size; smaller on a small picture of the page. */
  size?: number;
}) {
  const point = useAgentPoint(browserSessionId, shown || follow, step);
  const target = point ?? rest ?? null;
  const visible = shown && target !== null;
  const { boxRef, ringRef } = useGlide(target, point, { scale, size, present, visible });

  if (!visible) return null;
  return (
    <div
      ref={boxRef}
      aria-hidden
      data-present={present}
      className="agent-cursor pointer-events-none absolute left-0 top-0"
      style={{ width: size, height: size, opacity: present ? 1 : 0, transformOrigin: TIP_ORIGIN }}
    >
      <span
        ref={ringRef}
        className="agent-cursor-ring"
        style={{
          left: `${String(TIP.x * 100)}%`,
          top: `${String(TIP.y * 100)}%`,
          width: size * 1.4,
          height: size * 1.4,
        }}
      />
      <div
        className={`h-full w-full ${present ? 'agent-cursor-drift' : ''}`}
        style={{ transformOrigin: TIP_ORIGIN }}
      >
        <svg
          viewBox={`0 0 ${String(design.viewBoxSize)} ${String(design.viewBoxSize)}`}
          className="block h-full w-full"
          style={{ filter: GLYPH_FILTER }}
        >
          <path
            d={design.path}
            fill={ARTWORK.fill}
            fillOpacity={ARTWORK.fillOpacity}
            stroke={ARTWORK.stroke}
            strokeWidth={design.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {named && <StepChip step={step} present={present} size={size} />}
    </div>
  );
}

// The step's name tag. It keeps the last step's words while it fades, so a
// pause between two steps does not empty it first.
function StepChip({
  step,
  present,
  size,
}: {
  step: string | null;
  present: boolean;
  size: number;
}) {
  const [shown, setShown] = useState(step);
  if (step && step !== shown) setShown(step);
  if (!shown) return null;
  return (
    <span
      className="agent-cursor-chip"
      data-on={Boolean(step) && present}
      style={
        {
          background: ARTWORK.fill,
          color: design.styles.dark.fill,
          '--chip-at': `${String(size * 0.8)}px`,
        } as CSSProperties
      }
    >
      <span key={shown} className="cue-enter block truncate">
        {shown}…
      </span>
    </span>
  );
}

// Places the cursor's box at the target and glides it there from where it
// is drawn. The glide and ring in flight are owned here: a new point, a new
// drawing or the cursor going away cancels them, and nothing else of the
// cursor's (its fade) is touched. A late point as the cursor fades, or one on
// a new drawing, is placed at once.
function useGlide(
  target: Point | null,
  point: { n: number; click: boolean } | null,
  {
    scale,
    size,
    present,
    visible,
  }: { scale: number; size: number; present: boolean; visible: boolean },
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const placed = useRef<{ box: HTMLDivElement; scale: number; size: number } | null>(null);
  const motion = useRef<Animation[]>([]);
  const presentRef = useRef(present);
  presentRef.current = present;
  const tx = target?.x;
  const ty = target?.y;
  const pointed = point?.n;
  const click = point?.click ?? false;
  useLayoutEffect(() => {
    const box = boxRef.current;
    const last = placed.current;
    const from =
      box && last?.box === box && last.scale === scale && last.size === size ? onScreen(box) : null;
    for (const animation of motion.current) animation.cancel();
    motion.current = [];
    if (!box || tx === undefined || ty === undefined) return;
    placed.current = { box, scale, size };
    const to = { x: tx * scale - TIP.x * size, y: ty * scale - TIP.y * size };
    turnChip(box, { x: tx * scale, y: ty * scale });
    box.style.transform = translate(to);
    if (from && presentRef.current) motion.current = move(box, ringRef.current, from, to, click);
  }, [tx, ty, pointed, click, scale, size, visible]);
  useEffect(
    () => () => {
      for (const animation of motion.current) animation.cancel();
    },
    [],
  );
  return { boxRef, ringRef };
}

// Each point the agent sends while `listening`, numbered so pointing twice at
// one spot still lands twice, and whether it was for a click, read as the
// point came.
function useAgentPoint(browserSessionId: string, listening: boolean, step: string | null) {
  const [point, setPoint] = useState<(Point & { n: number; click: boolean }) | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!listening) return;
    return onNativeBrowserAgentPoint(({ browserSessionId: id, x, y }) => {
      if (id !== browserSessionId) return;
      const click = stepRef.current?.startsWith(CLICKING) ?? false;
      setPoint((last) => ({ x, y, n: (last?.n ?? 0) + 1, click }));
    });
  }, [browserSessionId, listening]);
  return point;
}

// Near the page's right or bottom edge the step's chip turns to the other side.
function turnChip(box: HTMLDivElement, tip: Point): void {
  const frame = box.offsetParent;
  if (!frame) return;
  box.dataset.flipX = String(tip.x + CHIP_ROOM.x > frame.clientWidth);
  box.dataset.flipY = String(tip.y + CHIP_ROOM.y > frame.clientHeight);
}

function translate({ x, y }: Point): string {
  return `translate(${String(x)}px, ${String(y)}px)`;
}

// Where the box is drawn right now, partway along a glide or at rest.
function onScreen(box: HTMLElement): Point {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(box).transform);
  return { x: matrix.m41, y: matrix.m42 };
}

// From where the box is drawn to its new place, as one animation the effect
// owns: along a gentle arc that lifts over the straight line, the way a hand
// moves a mouse, leaning into the way and eased in and out; then a settle, or
// for a click a press and a ring from the tip. Without motion it is placed at
// once, and a click only lights the ring.
function move(
  box: HTMLDivElement,
  ring: HTMLSpanElement | null,
  from: Point,
  to: Point,
  click: boolean,
): Animation[] {
  const ringOut = (delay: number, frames: Keyframe[]) =>
    click && ring ? [ring.animate(frames, { duration: 620, delay, easing: RING_EASING })] : [];
  if (reducedMotion()) return ringOut(0, [{ opacity: 0.6 }, { opacity: 0 }]);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // A longer way takes a little longer, from 200 to 560 ms; a short hop is straight.
  const glide = distance === 0 ? 0 : Math.min(560, 200 + distance * 0.4);
  const bow = distance < 48 ? 0 : Math.min(90, distance * 0.18) / distance;
  const lean = distance === 0 ? 0 : (dx / distance) * 7;
  const press = click ? 280 : 220;
  const total = glide + press;
  const at = (u: number) => {
    // Eased in and out along a quadratic curve whose control point sits off
    // the middle of the line, on the side that is up the screen.
    const t = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    const lift = 2 * t * (1 - t);
    const side = dx < 0 ? -1 : 1;
    return {
      x: from.x + dx * t + dy * bow * side * lift,
      y: from.y + dy * t - Math.abs(dx) * bow * lift,
    };
  };
  // Every frame names the same transforms, so each step between them is smooth.
  const pose = (place: Point, turn: number, pressed: number) =>
    `${translate(place)} rotate(${String(turn)}deg) scale(${String(pressed)})`;
  const frames: Keyframe[] = Array.from({ length: GLIDE_FRAMES + 1 }, (_, i) => {
    const u = i / GLIDE_FRAMES;
    return { offset: (u * glide) / total, transform: pose(at(u), lean * Math.sin(Math.PI * u), 1) };
  });
  frames.push(
    { offset: (glide + press * 0.35) / total, transform: pose(to, 0, click ? 0.8 : 0.93) },
    { offset: 1, transform: pose(to, 0, 1) },
  );
  return [
    box.animate(frames, { duration: total }),
    ...ringOut(glide, [
      { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
      { opacity: 0.75, offset: 0.45 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
    ]),
  ];
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
