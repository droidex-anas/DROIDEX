import { type CSSProperties } from 'react';

import { canvasActivity, type CanvasActivityStage, type CanvasMotion } from './canvasMotion';

const DOT_COUNT = 5;

/**
 * The quiet bloom inside a frame the agent is still working on. The dots loop
 * only while the frame is mounted, on screen and at a stage that is genuinely
 * busy; under reduced motion the stage label stands alone. The loop is a CSS
 * animation, so it owns no timer and the hidden-window rule in `index.css`
 * pauses it with the rest of the app.
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
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: DOT_COUNT }, (_, index) => (
          <span
            key={index}
            className={`h-1 w-1 rounded-full bg-droid-text-muted opacity-25 ${animated ? 'canvas-bloom-dot' : ''}`}
            style={animated ? dotStyle(motion.busyLoopMs, index, visible) : undefined}
          />
        ))}
      </div>
      <span className="text-xs text-droid-text-muted">{label}</span>
    </div>
  );
}

// A fifth of the loop between neighbours reads as a wave crossing the row
// rather than five dots blinking together.
function dotStyle(busyLoopMs: number, index: number, visible: boolean): CSSProperties {
  return {
    animationDuration: `${String(busyLoopMs)}ms`,
    animationDelay: `${String((index * busyLoopMs) / (DOT_COUNT * 2))}ms`,
    animationPlayState: visible ? 'running' : 'paused',
  };
}
