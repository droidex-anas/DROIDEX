// The agents at work on the board, each drawn over a frame it works on: its
// cursor with its name, wandering the frame, and under it a halftone cloud in
// its colour, on the same dot lattice as the frame's blank sheet. Only
// transform and opacity move, a frame off screen draws none, and under reduced
// motion each agent rests in one place.

import { AnimatePresence, motion as animated } from 'framer-motion';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { AgentCursor } from '../../components/AgentCursor';
import type { PlacedFrame } from './canvasGeometry';
import type { CanvasMotion } from './canvasMotion';
import { fnv1a, type CanvasPresence, type PresenceAgent } from './canvasPresence';
import type { FrameRect } from './protocol';

const CURSOR_SIZE = 22;
// The cloud's box as a share of the frame's width, centred on the cursor's tip.
const CLOUD_WIDTH = 0.6;
const CLOUD_HEIGHT = 0.3;
// The cloud follows the cursor a beat behind, so it reads as left in its wake.
const CLOUD_LAG_MS = 240;
const TRAVEL_EASE = 'cubic-bezier(0.45, 0, 0.1, 1)';

export function CanvasPresenceLayer({
  presence,
  drawn,
  visible,
  motion,
}: {
  presence: CanvasPresence;
  drawn: readonly PlacedFrame[];
  /** The frames on screen; one off screen draws no presence, so nothing of it runs. */
  visible: readonly string[];
  motion: CanvasMotion;
}) {
  // One cursor per agent: an agent at work on several frames is drawn over
  // the first of them on screen, and its other frames keep only their edge.
  const drawnAgents = new Set<string>();
  const worked: { designId: string; rect: FrameRect; agent: PresenceAgent }[] = [];
  for (const { designId, rect } of drawn) {
    const agent = presence.get(designId);
    if (!agent || drawnAgents.has(agent.key) || !visible.includes(designId)) continue;
    drawnAgents.add(agent.key);
    worked.push({ designId, rect, agent });
  }
  return (
    <AnimatePresence>
      {worked.map(({ designId, rect, agent }) => (
        <FramePresence
          key={`${designId}\0${agent.key}`}
          designId={designId}
          rect={rect}
          agent={agent}
          motion={motion}
        />
      ))}
    </AnimatePresence>
  );
}

function FramePresence({
  designId,
  rect,
  agent,
  motion,
}: {
  designId: string;
  rect: FrameRect;
  agent: PresenceAgent;
  motion: CanvasMotion;
}) {
  const cursor = useRef<HTMLDivElement>(null);
  const cloud = useRef<HTMLDivElement>(null);
  const lattice = useRef<HTMLDivElement>(null);
  // Kept across the board's renders, which come with every pan, so the loop
  // never restarts while the agent stays.
  const path = useMemo(() => wanderPath(`${agent.key}\0${designId}`), [agent.key, designId]);
  const moves = motion.presenceMs > 0;

  useEffect(() => {
    if (!moves || !cursor.current || !cloud.current || !lattice.current) return;
    const duration = path.reduce((total, stop) => total + stop.travelMs + stop.restMs, 0);
    const timing = { duration, iterations: Infinity };
    const lagged = { ...timing, delay: CLOUD_LAG_MS };
    // The lattice moves against the cloud that holds it, so its dots stay on
    // the frame's own grid while the cloud's soft edge passes over them.
    const animations = [
      cursor.current.animate(wanderKeyframes(path, duration, 1), timing),
      cloud.current.animate(wanderKeyframes(path, duration, 1), lagged),
      lattice.current.animate(wanderKeyframes(path, duration, -1), lagged),
    ];
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [moves, path]);

  const cloudWidth = rect.width * CLOUD_WIDTH;
  const cloudHeight = rect.width * CLOUD_HEIGHT;
  // An agent's presence often comes with the frame it just made, so it waits
  // for that frame's arrival to land; it leaves alongside its working state.
  const enter = {
    duration: motion.presenceMs / 1000,
    delay: motion.frameArrivalMs / 1000,
    ease: motion.ease,
  };
  const leave = { duration: motion.readyMs / 1000, ease: motion.ease };
  return (
    <animated.div
      aria-hidden
      className="canvas-presence"
      style={
        {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          '--worker': `var(--presence-${agent.color})`,
        } as CSSProperties
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: enter }}
      exit={{ opacity: 0, transition: leave }}
    >
      <div className="canvas-presence-clip">
        <div ref={cloud} className="canvas-presence-track" style={{ transform: at(path[0], 1) }}>
          <div
            className="canvas-presence-cloud"
            style={{
              left: -cloudWidth / 2,
              top: -cloudHeight / 2,
              width: cloudWidth,
              height: cloudHeight,
            }}
          >
            <div
              ref={lattice}
              className="canvas-presence-lattice"
              style={{
                left: cloudWidth / 2,
                top: cloudHeight / 2,
                width: rect.width,
                height: rect.height,
                transform: at(path[0], -1),
              }}
            />
          </div>
        </div>
      </div>
      <div ref={cursor} className="canvas-presence-track" style={{ transform: at(path[0], 1) }}>
        <div className="canvas-presence-cursor">
          <AgentCursor
            size={CURSOR_SIZE}
            working
            agent={{ name: agent.name, color: 'var(--worker)' }}
          />
        </div>
      </div>
    </animated.div>
  );
}

interface WanderStop {
  /** Where the cursor's tip stops, as a share of the frame's width and height. */
  x: number;
  y: number;
  travelMs: number;
  restMs: number;
}

const STOPS = 5;
const MIN_STEP = 0.2;

/**
 * The loop an agent's cursor wanders on a frame: a few stops well inside it,
 * each a clear move from the last, reached in one to two seconds and held a
 * moment. The same agent on the same frame always takes the same way.
 */
function wanderPath(seed: string): WanderStop[] {
  const random = mulberry32(fnv1a(seed));
  const stops: WanderStop[] = [];
  while (stops.length < STOPS) {
    const x = 0.2 + random() * 0.55;
    const y = 0.22 + random() * 0.5;
    const last = stops.at(-1);
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_STEP) continue;
    stops.push({ x, y, travelMs: 1000 + random() * 1000, restMs: 300 + random() * 600 });
  }
  return stops;
}

function wanderKeyframes(path: WanderStop[], duration: number, sign: 1 | -1): Keyframe[] {
  const keyframes: Keyframe[] = [];
  let elapsed = 0;
  for (const [index, stop] of path.entries()) {
    const next = path[(index + 1) % path.length];
    keyframes.push({ offset: elapsed / duration, transform: at(stop, sign), easing: 'linear' });
    elapsed += stop.restMs;
    keyframes.push({ offset: elapsed / duration, transform: at(stop, sign), easing: TRAVEL_EASE });
    elapsed += stop.travelMs;
    if (index === path.length - 1) keyframes.push({ offset: 1, transform: at(next, sign) });
  }
  return keyframes;
}

/** A translation by a share of the element's own box, which is the frame's. */
function at(stop: Pick<WanderStop, 'x' | 'y'>, sign: 1 | -1): string {
  return `translate(${String(sign * stop.x * 100)}%, ${String(sign * stop.y * 100)}%)`;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
