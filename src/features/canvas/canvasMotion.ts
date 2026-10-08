// The single owner of Canvas motion. Spec §11 states the timings once here so
// the board, frames, toolbar, artifact card and presence layer all read the
// same numbers, and so reduced motion is resolved in one place instead of a
// conditional in every component. Pan, drag and resize are absent on purpose:
// direct pointer input follows the hand 1:1 and never passes through a token.

import type { CanvasBuildState } from './protocol';

/** Stages that come from real session events. There is no "verifying" stage. */
export type CanvasActivityStage =
  | 'queued'
  | 'writing'
  | 'building'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface CanvasActivity {
  /** Short status text shown under a frame. */
  readonly label: string;
  /** Whether the pending bloom belongs to this stage, i.e. the agent is working. */
  readonly bloom: boolean;
}

export const canvasActivity: Readonly<Record<CanvasActivityStage, CanvasActivity>> = Object.freeze({
  queued: Object.freeze({ label: 'Queued', bloom: false }),
  writing: Object.freeze({ label: 'Writing', bloom: true }),
  building: Object.freeze({ label: 'Building', bloom: true }),
  ready: Object.freeze({ label: 'Ready', bloom: false }),
  failed: Object.freeze({ label: 'Failed', bloom: false }),
  cancelled: Object.freeze({ label: 'Cancelled', bloom: false }),
});

/**
 * The stage a frame's own build reports, which is the only stage the Canvas wire
 * can currently prove. `writing` is deliberately unreachable from here: a build
 * state cannot tell whether an agent is still writing the source, so claiming it
 * needs an actor event that no change feed carries yet.
 */
export function activityStageOf(status: CanvasBuildState['status']): CanvasActivityStage {
  return status === 'pending' ? 'queued' : status;
}

export interface CanvasMotion {
  /** Programmatic focus, fit and zoom-to-frame. */
  readonly focusMs: number;
  /** Pane and inspector expand/collapse layout transition. */
  readonly paneMs: number;
  /** Toolbar and popover reveal. */
  readonly popoverMs: number;
  /** A frame arriving on the board, including a reserved variant sibling. */
  readonly frameArrivalMs: number;
  /** Crossfade to the first working preview. Never padded with a fake delay. */
  readonly readyMs: number;
  /** Interpolation toward a presence target reported by real telemetry. */
  readonly presenceMs: number;
  /** One cycle of the pending bloom. Zero means the bloom does not run. */
  readonly busyLoopMs: number;
  /** Travel allowed for a toolbar or popover reveal. */
  readonly popoverTravelPx: number;
  /** Travel allowed for an arriving frame. */
  readonly frameArrivalTravelPx: number;
  /** Easing for framer-motion `transition.ease`. */
  readonly ease: readonly [number, number, number, number];
  /** The same easing for a CSS `transition` or `animation` shorthand. */
  readonly easeCss: string;
}

const ease: readonly [number, number, number, number] = Object.freeze([0.22, 1, 0.36, 1]);
const easeCss = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const canvasMotion: CanvasMotion = Object.freeze({
  focusMs: 220,
  paneMs: 200,
  popoverMs: 120,
  frameArrivalMs: 180,
  readyMs: 120,
  presenceMs: 140,
  busyLoopMs: 1600,
  popoverTravelPx: 4,
  frameArrivalTravelPx: 8,
  ease,
  easeCss,
});

// Reduced motion keeps the easing shape so a transition object stays valid, and
// drops every duration and distance to zero: fit, focus, layout, arrival and
// reveal all land immediately, presence is a static badge, and the bloom becomes
// a static label.
const reducedCanvasMotion: CanvasMotion = Object.freeze({
  focusMs: 0,
  paneMs: 0,
  popoverMs: 0,
  frameArrivalMs: 0,
  readyMs: 0,
  presenceMs: 0,
  busyLoopMs: 0,
  popoverTravelPx: 0,
  frameArrivalTravelPx: 0,
  ease,
  easeCss,
});

export function motionFor(reducedMotion: boolean): CanvasMotion {
  return reducedMotion ? reducedCanvasMotion : canvasMotion;
}
