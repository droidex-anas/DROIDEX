// The in-page half of the canvas scenario, installed before the page's own
// scripts. Between begin() and end() it keeps every animation frame, long task
// and long animation frame; between streamStart() and streamEnd() it counts
// React commits, the components they rendered (when asked) and layout reads.

export interface ProbeWindow {
  /** rAF timestamps while the input stream ran. */
  frameTimes: number[];
  commits: number;
  /** Components React rendered in those commits; 0 unless the window counted them. */
  renders: number;
  /** Geometry reads that can force layout: rects, offsets and client sizes. */
  layoutReads: number;
  /** Durations of long tasks (over 50 ms) anywhere in the window. */
  longTasks: number[];
  /** Durations of long animation frames (over 50 ms) anywhere in the window. */
  longFrames: number[];
}

interface CanvasProbe {
  begin: (countRenders: boolean) => void;
  streamStart: () => void;
  streamEnd: () => void;
  end: () => ProbeWindow;
}

declare global {
  interface Window {
    canvasProbe: CanvasProbe;
  }
}

/** The user-timing mark at the start of every streamed frame, which the trace splits frames by. */
export const FRAME_MARK = 'canvas-probe-frame';

/**
 * esbuild's keepNames wraps named functions in `__name`, which a page does not
 * define; every function this scenario hands the page needs it first.
 */
export const NAME_SHIM = 'globalThis.__name = (target) => target;';

/** Runs in the page, so it closes over nothing. */
export function installProbe(frameMark: string) {
  interface Fiber {
    tag: number;
    flags: number;
    alternate: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
  }
  // FunctionComponent, ClassComponent, ForwardRef, MemoComponent, SimpleMemoComponent.
  const componentTags = new Set([0, 1, 11, 14, 15]);
  const performedWork = 1;
  // A subtree React bailed out of keeps its previous children, so only children
  // this commit reconciled are walked, as React DevTools does.
  const rendered = (fiber: Fiber): number => {
    const didRender = fiber.alternate === null || (fiber.flags & performedWork) !== 0;
    let count = componentTags.has(fiber.tag) && didRender ? 1 : 0;
    if (fiber.alternate !== null && fiber.alternate.child === fiber.child) return count;
    for (let child = fiber.child; child; child = child.sibling) count += rendered(child);
    return count;
  };

  let window_ = { begunAt: 0, endedAt: 0, streaming: false, countRenders: false };
  let counts = { frameTimes: [] as number[], commits: 0, renders: 0, layoutReads: 0 };
  const longTasks: { startTime: number; duration: number }[] = [];
  const longFrames: { startTime: number; duration: number }[] = [];

  // React looks for DevTools' hook when it loads and reports every commit to it.
  let renderers = 0;
  Object.assign(window, {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      renderers: new Map(),
      supportsFiber: true,
      inject: () => (renderers += 1),
      onScheduleFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        if (!window_.streaming) return;
        counts.commits += 1;
        if (window_.countRenders) counts.renders += rendered(root.current);
      },
    },
  });

  const countRead = () => {
    if (window_.streaming) counts.layoutReads += 1;
  };
  for (const name of ['getBoundingClientRect', 'getClientRects'] as const) {
    const read = Element.prototype[name];
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      value(this: Element) {
        countRead();
        return Reflect.apply(read, this, []) as unknown;
      },
    });
  }
  const getters: [object, string[]][] = [
    [Element.prototype, ['clientWidth', 'clientHeight', 'clientLeft', 'clientTop']],
    [HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop']],
  ];
  for (const [prototype, names] of getters) {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      const get = descriptor?.get;
      if (!get) continue;
      Object.defineProperty(prototype, name, {
        ...descriptor,
        get(this: Element) {
          countRead();
          return get.call(this) as number;
        },
      });
    }
  }

  const tick = (time: number) => {
    if (window_.streaming) {
      counts.frameTimes.push(time);
      performance.mark(frameMark);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const keep =
    (into: { startTime: number; duration: number }[]) => (list: PerformanceObserverEntryList) => {
      for (const entry of list.getEntries())
        into.push({ startTime: entry.startTime, duration: entry.duration });
    };
  new PerformanceObserver(keep(longTasks)).observe({ type: 'longtask' });
  new PerformanceObserver(keep(longFrames)).observe({ type: 'long-animation-frame' });

  const within = (entries: { startTime: number; duration: number }[]) =>
    entries
      .filter((entry) => entry.startTime >= window_.begunAt && entry.startTime < window_.endedAt)
      .map((entry) => entry.duration);
  window.canvasProbe = {
    begin: (countRenders) => {
      window_ = { begunAt: performance.now(), endedAt: Infinity, streaming: false, countRenders };
      counts = { frameTimes: [], commits: 0, renders: 0, layoutReads: 0 };
    },
    streamStart: () => {
      window_.streaming = true;
    },
    streamEnd: () => {
      window_.streaming = false;
    },
    end: () => {
      window_.endedAt = performance.now();
      return { ...counts, longTasks: within(longTasks), longFrames: within(longFrames) };
    },
  };
}
