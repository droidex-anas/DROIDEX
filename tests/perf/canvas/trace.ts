// Reads a Chrome trace of one gesture into the work each frame did on the
// page's main thread. Frames are split at the probe's mark, which every
// animation frame of the stream sets in its rAF callback.

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
}

export interface FrameWork {
  /** Main-thread time each frame spent in tasks, in ms. */
  busyMs: number[];
  /** Style recalcs and layouts that script asked for before the frame's own. */
  forcedStyles: number;
  forcedLayouts: number;
  /** Totals over every frame, in ms. */
  scriptMs: number;
  styleMs: number;
  layoutMs: number;
  paintMs: number;
  /** Tiles rastered on the raster workers. */
  rasterTasks: number;
}

const TASK = 'ThreadControllerImpl::RunTask';
const SCRIPT = new Set(['FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame']);
const PAINT = new Set(['PrePaint', 'Paint', 'Layerize']);

export function readFrameWork(trace: Buffer, frameMark: string): FrameWork {
  const { traceEvents } = JSON.parse(trace.toString()) as { traceEvents: TraceEvent[] };
  const marks = traceEvents.filter((event) => event.name === frameMark).sort((a, b) => a.ts - b.ts);
  const first = marks.at(0);
  const last = marks.at(-1);
  if (!first || !last || marks.length < 2)
    throw new Error('The trace holds fewer than two frames.');
  const within = (event: TraceEvent) => event.ts >= first.ts && event.ts < last.ts;
  const main = traceEvents
    .filter((event) => event.pid === first.pid && event.tid === first.tid && event.ph === 'X')
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));

  const busyMs = marks.slice(1).map((end, index) => {
    const start = marks[index].ts;
    let busy = 0;
    for (const task of main) {
      if (task.name !== TASK) continue;
      const overlap = Math.min(end.ts, task.ts + (task.dur ?? 0)) - Math.max(start, task.ts);
      if (overlap > 0) busy += overlap;
    }
    return busy / 1000;
  });

  const work: FrameWork = {
    busyMs,
    forcedStyles: 0,
    forcedLayouts: 0,
    scriptMs: 0,
    styleMs: 0,
    layoutMs: 0,
    paintMs: 0,
    rasterTasks: traceEvents.filter(
      (event) => event.pid === first.pid && event.name === 'RasterTask' && within(event),
    ).length,
  };
  // Events nest by time on one thread, so the open ones say what ran this one.
  const open: TraceEvent[] = [];
  for (const event of main) {
    while (open.length > 0 && openUntil(open[open.length - 1]) <= event.ts) open.pop();
    const inScript = open.some((outer) => SCRIPT.has(outer.name));
    open.push(event);
    if (!within(event)) continue;
    const ms = (event.dur ?? 0) / 1000;
    if (SCRIPT.has(event.name) && !inScript) work.scriptMs += ms;
    if (event.name === 'UpdateLayoutTree') {
      work.styleMs += ms;
      if (inScript) work.forcedStyles += 1;
    }
    if (event.name === 'Layout') {
      work.layoutMs += ms;
      if (inScript) work.forcedLayouts += 1;
    }
    if (PAINT.has(event.name)) work.paintMs += ms;
  }
  return work;
}

function openUntil(event: TraceEvent): number {
  return event.ts + (event.dur ?? 0);
}
