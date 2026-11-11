// One gesture on one board, measured: a warm-up stream that also counts the
// components each commit rendered and checks the gesture moved what it
// should, a timed stream for frame pacing and
// counts, and a traced stream for the main thread's work per frame. Tracing
// and the render walk each slow the page, so neither runs in the timed stream.

import type { Browser, Page } from '@playwright/test';
import { openGrid, settle } from './board';
import type { Gesture } from './gestures';
import { FRAME_MARK, type ProbeWindow } from './probe';
import { readFrameWork } from './trace';

/** 120 Hz: the budget for a frame's main-thread work. */
export const FRAME_BUDGET_MS = 1000 / 120;

const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing',
  'toplevel',
];

export interface GestureSample {
  frames: number;
  commitsPerFrame: number;
  rendersPerFrame: number;
  layoutReadsPerFrame: number;
  forcedStylesPerFrame: number;
  forcedLayoutsPerFrame: number;
  rasterTasksPerFrame: number;
  busyP50Ms: number;
  busyP95Ms: number;
  busyP99Ms: number;
  /** Share of frames whose main-thread work went over the 8.33 ms budget. */
  overBudgetShare: number;
  scriptMsPerFrame: number;
  styleMsPerFrame: number;
  layoutMsPerFrame: number;
  paintMsPerFrame: number;
  rafP50Ms: number;
  rafP95Ms: number;
  rafP99Ms: number;
  /** Frame gaps over 1.5 × the median gap. */
  droppedFrames: number;
  longTasks: number;
  longestTaskMs: number;
  longAnimationFrames: number;
}

export async function measureGesture(
  browser: Browser,
  harnessUrl: string,
  frames: number,
  gesture: Gesture,
): Promise<GestureSample> {
  const page = await openGrid(browser, harnessUrl, frames, gesture.tool);
  try {
    await gesture.prepare?.(page);
    const warm = await stream(page, gesture, true);
    const timed = await stream(page, gesture, false);
    await browser.startTracing(page, { categories: TRACE_CATEGORIES });
    let trace: Buffer;
    try {
      await stream(page, gesture, false);
    } finally {
      trace = await browser.stopTracing();
    }
    const work = readFrameWork(trace, FRAME_MARK);
    const tracedFrames = work.busyMs.length;
    const count = timed.frameTimes.length;
    const gaps = timed.frameTimes.slice(1).map((time, index) => time - timed.frameTimes[index]);
    const medianGap = percentile(gaps, 50);
    return {
      frames: count,
      commitsPerFrame: timed.commits / count,
      rendersPerFrame: warm.renders / warm.frameTimes.length,
      layoutReadsPerFrame: timed.layoutReads / count,
      forcedStylesPerFrame: work.forcedStyles / tracedFrames,
      forcedLayoutsPerFrame: work.forcedLayouts / tracedFrames,
      rasterTasksPerFrame: work.rasterTasks / tracedFrames,
      busyP50Ms: percentile(work.busyMs, 50),
      busyP95Ms: percentile(work.busyMs, 95),
      busyP99Ms: percentile(work.busyMs, 99),
      overBudgetShare: work.busyMs.filter((ms) => ms > FRAME_BUDGET_MS).length / tracedFrames,
      scriptMsPerFrame: work.scriptMs / tracedFrames,
      styleMsPerFrame: work.styleMs / tracedFrames,
      layoutMsPerFrame: work.layoutMs / tracedFrames,
      paintMsPerFrame: work.paintMs / tracedFrames,
      rafP50Ms: medianGap,
      rafP95Ms: percentile(gaps, 95),
      rafP99Ms: percentile(gaps, 99),
      droppedFrames: gaps.filter((gap) => gap > 1.5 * medianGap).length,
      longTasks: timed.longTasks.length,
      longestTaskMs: Math.max(0, ...timed.longTasks),
      longAnimationFrames: timed.longFrames.length,
    };
  } finally {
    await page.context().close();
  }
}

/** One stream of the gesture, and what the probe kept from its start to the board settling after it. */
async function stream(page: Page, gesture: Gesture, warm: boolean): Promise<ProbeWindow> {
  const watch = warm ? (gesture.moves ?? null) : null;
  await page.evaluate(
    ({ warm, watch }) => {
      window.canvasProbe.begin(warm, watch);
      window.canvasProbe.streamStart();
    },
    { warm, watch },
  );
  await gesture.stream(page);
  await page.evaluate(() => {
    window.canvasProbe.streamEnd();
  });
  await settle(page);
  const kept = await page.evaluate(() => window.canvasProbe.end());
  if (kept.frameTimes.length < 2)
    throw new Error(`${gesture.name} streamed fewer than two frames.`);
  // The stream ends where it began, so only its frames between show it moved.
  if (watch && kept.watchedStyles < 2) throw new Error(`${gesture.name} did not move ${watch}.`);
  return kept;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], rank: number): number {
  if (values.length === 0) return NaN;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1)];
}
