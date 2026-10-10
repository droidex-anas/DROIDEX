import { type CSSProperties } from 'react';

import { canvasActivity, type CanvasActivityStage, type CanvasMotion } from './canvasMotion';

/**
 * The quiet bloom inside a frame the agent is still working on: its stage name
 * in the same activity shimmer the chat uses. The shimmer runs only while the
 * frame is mounted, on screen and at a stage that is genuinely busy; under
 * reduced motion the stage name stands still. The loop is a CSS animation, so
 * it owns no timer and the hidden-window rule in `index.css` pauses it with the
 * rest of the app.
 */
export function PendingBloom({
  stage,
  visible,
  motion,
}: {
  stage: CanvasActivityStage;
  visible: boolean;
  motion: CanvasMotion;
}) {
  const { label, bloom } = canvasActivity[stage];
  const animated = bloom && motion.busyLoopMs > 0;

  return (
    <span
      className={`canvas-sheet-title ${animated ? 'canvas-bloom-label' : ''}`}
      style={animated ? shimmerStyle(motion.busyLoopMs, visible) : undefined}
    >
      {label}
    </span>
  );
}

function shimmerStyle(busyLoopMs: number, visible: boolean): CSSProperties {
  return {
    animationDuration: `${String(busyLoopMs)}ms`,
    animationPlayState: visible ? 'running' : 'paused',
  };
}
