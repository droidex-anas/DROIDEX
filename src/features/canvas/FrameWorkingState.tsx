// A frame an agent is at work on: an edge in the agent's colour and, while the
// frame has no design to show yet, a blank sheet with a faint dot lattice for
// the agent to draw on. When the agent leaves, the state fades out over
// whatever the frame shows by then, so the design arrives as a cross-fade.

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { CanvasMotion } from './canvasMotion';
import type { PresenceAgent } from './canvasPresence';

export function FrameWorkingState({
  worker,
  preview,
  shownRevisionId,
  motion,
}: {
  worker: PresenceAgent | undefined;
  preview: ReactNode | null;
  shownRevisionId: string | null;
  motion: CanvasMotion;
}) {
  const [previous, setPrevious] = useState(worker);
  const [leaving, setLeaving] = useState<PresenceAgent>();
  if (worker?.key !== previous?.key) {
    setPrevious(worker);
    setLeaving(worker || motion.readyMs === 0 ? undefined : previous);
  }
  const drawn = worker ?? leaving;
  if (!drawn) return null;
  const blank = !preview && shownRevisionId === null;
  return (
    <div
      className="canvas-working"
      style={workingStyle(drawn, worker === undefined, motion)}
      onAnimationEnd={(event) => {
        if (!worker && event.target === event.currentTarget) setLeaving(undefined);
      }}
    >
      <div
        aria-hidden
        className="canvas-working-sheet"
        style={{
          opacity: blank ? 1 : 0,
          transition:
            motion.readyMs > 0
              ? `opacity ${String(motion.readyMs)}ms ${motion.easeCss}`
              : undefined,
        }}
      />
      {worker && <span className="sr-only">{worker.name} is working on this frame</span>}
    </div>
  );
}

/** Entering takes `presenceMs` and leaving the shorter `readyMs`, alongside the design's own fade. */
function workingStyle(agent: PresenceAgent, leaving: boolean, motion: CanvasMotion): CSSProperties {
  const ms = leaving ? motion.readyMs : motion.presenceMs;
  const name = leaving ? 'canvas-working-out' : 'canvas-working-in';
  return {
    '--worker': `var(--presence-${agent.color})`,
    animation: ms > 0 ? `${name} ${String(ms)}ms ${motion.easeCss} both` : undefined,
  } as CSSProperties;
}
