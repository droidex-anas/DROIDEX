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
// The room the step's chip takes beside the glyph, so it turns to the other
// side near the page's right or bottom edge rather than being cut off.
const CHIP_ROOM = { x: 190, y: 64 };
// The working line's word for a click (lib/browserTools), which lands with a press.
const CLICKING = 'Clicking';

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
 * waits for it. It follows the page's points whether the pane shows the page
 * or not, and draws only when it does.
 */
export function BrowserAgentCursor({
  browserSessionId,
  scale,
  shown,
  present,
  step = null,
  named = false,
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
  /** Where it waits before the agent first points, in the page's pixels. */
  rest?: Point;
  /** The glyph's size; smaller on a small picture of the page. */
  size?: number;
}) {
  // Each point the agent sends, numbered, so pointing twice at one spot still lands twice.
  const [point, setPoint] = useState<(Point & { n: number }) | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<SVGSVGElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  // Where the box was last placed, and on which element and scale, so only a
  // new point on the same drawing glides; anything else is placed at once.
  const placed = useRef<{ box: HTMLDivElement; scale: number; size: number } | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(
    () =>
      onNativeBrowserAgentPoint(({ browserSessionId: id, x, y }) => {
        if (id === browserSessionId) setPoint((last) => ({ x, y, n: (last?.n ?? 0) + 1 }));
      }),
    [browserSessionId],
  );

  const target = point ?? rest ?? null;
  const visible = shown && target !== null;
  const tx = target?.x;
  const ty = target?.y;
  const pointed = point?.n;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || tx === undefined || ty === undefined) return;
    const to = { x: tx * scale - TIP.x * size, y: ty * scale - TIP.y * size };
    const last = placed.current;
    placed.current = { box, scale, size };
    const frame = box.offsetParent;
    if (frame) {
      box.dataset.flipX = String(tx * scale + CHIP_ROOM.x > frame.clientWidth);
      box.dataset.flipY = String(ty * scale + CHIP_ROOM.y > frame.clientHeight);
    }
    const from =
      last?.box === box && last.scale === scale && last.size === size ? onScreen(box) : null;
    box.style.transform = translate(to);
    if (!from) return;
    const clicking = () => stepRef.current?.startsWith(CLICKING) ?? false;
    move(box, { glyph: glyphRef.current, ring: ringRef.current }, from, to, clicking);
  }, [tx, ty, pointed, scale, size, visible]);

  if (!visible) return null;
  return (
    <div
      ref={boxRef}
      aria-hidden
      data-present={present}
      className="agent-cursor pointer-events-none absolute left-0 top-0"
      style={{ width: size, height: size, opacity: present ? 1 : 0 }}
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
        style={{ transformOrigin: `${String(TIP.x * 100)}% ${String(TIP.y * 100)}%` }}
      >
        <svg
          ref={glyphRef}
          viewBox={`0 0 ${String(design.viewBoxSize)} ${String(design.viewBoxSize)}`}
          className="block h-full w-full"
          style={{
            filter: GLYPH_FILTER,
            transformOrigin: `${String(TIP.x * 100)}% ${String(TIP.y * 100)}%`,
          }}
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

function translate({ x, y }: Point): string {
  return `translate(${String(x)}px, ${String(y)}px)`;
}

// Where the box is drawn right now, partway along a glide or at rest.
function onScreen(box: HTMLElement): Point {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(box).transform);
  return { x: matrix.m41, y: matrix.m42 };
}

// From where the box is drawn to its new place: on an arc, leaning into the
// way, landing at the end. Without motion it is placed at once, and a click
// only lights the ring.
function move(
  box: HTMLDivElement,
  { glyph, ring }: { glyph: SVGSVGElement | null; ring: HTMLSpanElement | null },
  from: Point,
  to: Point,
  clicking: () => boolean,
): void {
  if (reducedMotion()) {
    if (clicking()) ring?.animate([{ opacity: 0.6 }, { opacity: 0 }], { duration: 620 });
    return;
  }
  if (from.x === to.x && from.y === to.y) {
    land(glyph, ring, clicking());
    return;
  }
  for (const running of box.getAnimations()) running.cancel();
  const duration = glideMs(from, to);
  const glide = box.animate(arc(from, to), { duration, easing: 'cubic-bezier(0.45, 0, 0.12, 1)' });
  glyph?.animate(
    { rotate: ['0deg', `${String(lean(from, to))}deg`, '0deg'], offset: [0, 0.4, 1] },
    { duration, easing: 'ease-in-out' },
  );
  glide.finished.then(
    () => {
      land(glyph, ring, clicking());
    },
    // Cut short by the next point, which lands instead.
    () => undefined,
  );
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A longer way takes a little longer, from 200 to 560 ms.
function glideMs(from: Point, to: Point): number {
  return Math.round(Math.min(560, 200 + Math.hypot(to.x - from.x, to.y - from.y) * 0.4));
}

// The way there as a gentle arc that lifts over the straight line, the way a
// hand moves a mouse; a short hop stays straight.
function arc(from: Point, to: Point): Keyframe[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const bow = distance < 48 ? 0 : Math.min(90, distance * 0.18);
  // The side of the line that is up the screen; a straight drop bows right.
  const side = dx < 0 ? -1 : 1;
  const control = {
    x: (from.x + to.x) / 2 + (dy / distance) * bow * side,
    y: (from.y + to.y) / 2 - (Math.abs(dx) / distance) * bow,
  };
  const STEPS = 16;
  return Array.from({ length: STEPS + 1 }, (_, index) => {
    const t = index / STEPS;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return {
      transform: translate({
        x: a * from.x + b * control.x + c * to.x,
        y: a * from.y + b * control.y + c * to.y,
      }),
    };
  });
}

// The glyph leans a few degrees into the way it is going.
function lean(from: Point, to: Point): number {
  const dx = to.x - from.x;
  const distance = Math.hypot(dx, to.y - from.y) || 1;
  return Math.round((dx / distance) * 7);
}

// Arriving, the glyph settles; a click presses it and sends out a soft ring.
function land(glyph: SVGSVGElement | null, ring: HTMLSpanElement | null, click: boolean): void {
  glyph?.animate(
    { scale: ['1', click ? '0.8' : '0.93', '1'], offset: [0, 0.35, 1] },
    { duration: click ? 280 : 220, easing: 'ease-out' },
  );
  if (!click) return;
  ring?.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
      { opacity: 0.75, offset: 0.45 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
    ],
    { duration: 620, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
  );
}
