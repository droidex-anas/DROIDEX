export interface ScrollMetrics {
  speed: string;
  frameCount: number;
  expectedFrames: number;
  droppedFrames: number;
  longestFrameMs: number;
  longTasksOver50Ms: number;
  longTaskMaxMs: number;
  blankHitRatio: number;
  blankDurationMs: number;
  blankMaxRatio: number;
  blankMaxHolePx?: number;
  mountedRowsMax: number;
  mountedRowsLast: number;
  cpuPercent: number;
  rssBytes: number;
}

export interface StreamingMetrics {
  wired: boolean;
  reason?: string;
  durationMs: number;
  droppedFrames: number;
  longestFrameMs: number;
  longTasksOver50Ms: number;
  receiveToPaintP50Ms?: number;
  receiveToPaintP95Ms?: number;
  receiveToPaintMaxMs?: number;
  receiveToPaintCount?: number;
  eventsReceived?: number;
  feedTextLen?: number;
  timedOut?: boolean;
  cpuPercent: number;
  rssBytes: number;
}

export interface RunResult {
  tree: 'baseline' | 'candidate';
  run: number;
  sha: string;
  coldOpen10kMs: number;
  switchTo3kMs: number;
  switchTo10kWarmMs: number;
  idleCpuPercent: number;
  idleRssBytes: number;
  appMetricsIdle: unknown;
  scroll3k: ScrollMetrics[];
  scroll10k: ScrollMetrics[];
  children: {
    openMs: number;
    mountedRows: number;
    childRowCount: number;
    scroll: ScrollMetrics | null;
  };
  streaming: StreamingMetrics | null;
  screenshotPath?: string;
}

export interface BenchTreeRef {
  name: 'baseline' | 'candidate';
  root: string;
  sha: string;
}

export interface Spread {
  median: number;
  min: number;
  max: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return sorted[mid] ?? 0;
}

export function spread(values: number[]): Spread {
  if (values.length === 0) return { median: 0, min: 0, max: 0 };
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

export function fmt(stat: Spread, digits = 1): string {
  return `${stat.median.toFixed(digits)} [${stat.min.toFixed(digits)}–${stat.max.toFixed(digits)}]`;
}

export function delta(a: number, b: number): string {
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}`;
}

function scrollSeries(
  results: RunResult[],
  tree: 'baseline' | 'candidate',
  chat: '3k' | '10k',
  speed: string,
) {
  const rows = results
    .filter((result) => result.tree === tree)
    .map((result) => (chat === '3k' ? result.scroll3k : result.scroll10k).find((row) => row.speed === speed))
    .filter((row): row is ScrollMetrics => Boolean(row));
  return {
    dropped: spread(rows.map((row) => row.droppedFrames)),
    longest: spread(rows.map((row) => row.longestFrameMs)),
    longTasks: spread(rows.map((row) => row.longTasksOver50Ms)),
    blankHit: spread(rows.map((row) => row.blankHitRatio)),
    blankMs: spread(rows.map((row) => row.blankDurationMs)),
    blankMax: spread(rows.map((row) => row.blankMaxRatio)),
    holePx: spread(rows.map((row) => row.blankMaxHolePx ?? 0)),
    mounted: spread(rows.map((row) => row.mountedRowsLast)),
    cpu: spread(rows.map((row) => row.cpuPercent)),
    rss: spread(rows.map((row) => row.rssBytes)),
    frames: spread(rows.map((row) => row.frameCount)),
  };
}

const SPEEDS = ['gentle', 'normal', 'flick'] as const;

export function renderReport(results: RunResult[], trees: BenchTreeRef[]): string {
  const baseline = results.filter((result) => result.tree === 'baseline');
  const candidate = results.filter((result) => result.tree === 'candidate');
  const lines: string[] = [];
  lines.push('# DROIDEX GUI bench: baseline vs candidate');
  lines.push('');
  lines.push('## Caveat');
  lines.push('');
  lines.push(
    'If the host software-rasterizes, absolute FPS does not represent a hardware-accelerated desktop. Compare both trees on the same host using CPU, main-thread long tasks, dropped rAF frames, RSS, session-switch times, and blank-during-scroll.',
  );
  lines.push('');
  lines.push('## Refs');
  lines.push('');
  const historyShas = [...new Set(results.map((row) => `${row.tree} history ${row.sha}`))];
  for (const line of historyShas) lines.push(`- measured: ${line}`);
  for (const tree of trees) lines.push(`- **${tree.name} tooling HEAD at report** \`${tree.sha}\` (${tree.root})`);
  lines.push('');
  lines.push('## Method');
  lines.push('');
  lines.push('- One Electron app at a time, alternating baseline/candidate for the requested number of runs.');
  lines.push('- Seeded Factory JSONL history (`gui-bench-3k` ~3000 events, `gui-bench-10k` ~10000 events, `gui-bench-children` 24 child sessions). Separate `DROIDEX_USER_DATA_DIR` and `HOME` per run.');
  lines.push('- Drive via CDP `Input.dispatchMouseEvent` `mouseWheel` at gentle −40 px, normal −120 px, flick −480 px per 16 ms tick.');
  lines.push('- Frames: in-page `requestAnimationFrame` timestamps. A drop is a rAF gap > 1.5×16.67 ms (~25 ms).');
  lines.push('- Long tasks: `PerformanceObserver({type:\'longtask\'})` with `startTime >= phaseStartedAt`, duration > 50 ms.');
  lines.push(
    '- Blank: each rAF, largest contiguous viewport gap not covered by `[data-feed-row-id]`. A **hit** is a hole taller than 96 px (one estimated row). Ordinary 16 px list gaps are not hits.',
  );
  lines.push('- CPU/RSS: `/proc` tree of the Electron PID (sum of descendants).');
  lines.push(
    '- Streaming: a **dev-only** sidecar bundle injects `ReplayFactoryRuntime` through `SessionManager` `dependencies.runtime`. It is separate from the production sidecar bundle.',
  );
  lines.push('');
  const metric = (name: string, pick: (row: RunResult) => number, digits = 1) => {
    const b = spread(baseline.map(pick));
    const c = spread(candidate.map(pick));
    lines.push(`| ${name} | ${fmt(b, digits)} | ${fmt(c, digits)} | ${delta(b.median, c.median)} |`);
  };
  lines.push('## Open / switch / idle');
  lines.push('');
  lines.push('| metric | baseline | candidate | Δ (cand − base) |');
  lines.push('| --- | --- | --- | --- |');
  metric('cold open 10k (ms)', (row) => row.coldOpen10kMs);
  metric('switch to 3k (ms)', (row) => row.switchTo3kMs);
  metric('warm switch to 10k (ms)', (row) => row.switchTo10kWarmMs);
  metric('idle CPU % (sum of tree)', (row) => row.idleCpuPercent);
  metric('idle RSS (MiB)', (row) => row.idleRssBytes / (1024 * 1024));
  metric('children chat open (ms)', (row) => row.children.openMs);
  metric('children mounted rows', (row) => row.children.mountedRows, 0);
  metric('visible subagent rows', (row) => row.children.childRowCount, 0);
  lines.push('');
  for (const chat of ['3k', '10k'] as const) {
    lines.push(`## Scroll quality (${chat})`);
    lines.push('');
    lines.push('| speed | metric | baseline | candidate | Δ |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const speed of SPEEDS) {
      const b = scrollSeries(results, 'baseline', chat, speed);
      const c = scrollSeries(results, 'candidate', chat, speed);
      const row = (label: string, left: Spread, right: Spread, digits = 1) => {
        lines.push(`| ${speed} | ${label} | ${fmt(left, digits)} | ${fmt(right, digits)} | ${delta(left.median, right.median)} |`);
      };
      row('dropped rAF frames', b.dropped, c.dropped, 0);
      row('longest frame (ms)', b.longest, c.longest);
      row('long tasks >50ms', b.longTasks, c.longTasks, 0);
      row('blank hit ratio (hole>96px)', b.blankHit, c.blankHit, 3);
      row('blank duration (ms)', b.blankMs, c.blankMs);
      row('largest hole (px)', b.holePx, c.holePx);
      row('mounted rows', b.mounted, c.mounted, 0);
      row('CPU % during scroll', b.cpu, c.cpu);
      row(
        'RSS after (MiB)',
        {
          median: b.rss.median / (1024 * 1024),
          min: b.rss.min / (1024 * 1024),
          max: b.rss.max / (1024 * 1024),
        },
        {
          median: c.rss.median / (1024 * 1024),
          min: c.rss.min / (1024 * 1024),
          max: c.rss.max / (1024 * 1024),
        },
      );
    }
    lines.push('');
  }
  lines.push('## Streaming');
  lines.push('');
  const streamB = baseline.map((row) => row.streaming).filter((row): row is StreamingMetrics => Boolean(row));
  const streamC = candidate.map((row) => row.streaming).filter((row): row is StreamingMetrics => Boolean(row));
  const wiredB = streamB.filter((row) => row.wired);
  const wiredC = streamC.filter((row) => row.wired);
  if (streamB.length === 0 && streamC.length === 0) {
    lines.push('Streaming pass did not run.');
  } else {
    lines.push('| metric | baseline | candidate | Δ |');
    lines.push('| --- | --- | --- | --- |');
    const add = (name: string, pick: (row: StreamingMetrics) => number, digits = 1) => {
      const b = spread(wiredB.map(pick));
      const c = spread(wiredC.map(pick));
      const left = wiredB.length === 0 ? 'unwired' : fmt(b, digits);
      const right = wiredC.length === 0 ? 'unwired' : fmt(c, digits);
      const d = wiredB.length === 0 || wiredC.length === 0 ? 'n/a' : delta(b.median, c.median);
      lines.push(`| ${name} | ${left} | ${right} | ${d} |`);
    };
    add('duration (ms)', (row) => row.durationMs, 0);
    add('dropped rAF frames', (row) => row.droppedFrames, 0);
    add('longest frame (ms)', (row) => row.longestFrameMs);
    add('long tasks >50ms', (row) => row.longTasksOver50Ms, 0);
    add('receiveToPaint p50 (ms)', (row) => row.receiveToPaintP50Ms ?? 0);
    add('receiveToPaint p95 (ms)', (row) => row.receiveToPaintP95Ms ?? 0);
    add('receiveToPaint count', (row) => row.receiveToPaintCount ?? 0, 0);
    add('eventsReceived', (row) => row.eventsReceived ?? 0, 0);
    add('CPU %', (row) => row.cpuPercent);
    add('RSS (MiB)', (row) => row.rssBytes / (1024 * 1024));
    lines.push('');
    lines.push(
      'receiveToPaint is the renderer’s cumulative histogram from page start, not a stream-only delta. Compare count before vs after to determine how much the streamed answer contributes.',
    );
    const failedReasons = [
      ...new Set(
        [...streamB, ...streamC]
          .filter((row) => !row.wired)
          .map((row) => row.reason ?? 'unknown'),
      ),
    ];
    if (failedReasons.length > 0) {
      lines.push('');
      lines.push('Streaming wiring notes:');
      for (const reason of failedReasons) lines.push(`- ${reason}`);
    }
  }
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push(
    '- **Blank during scroll:** compare blank-hit ratio and largest hole with the transcript content. Empty space below a short transcript is not a virtualizer miss.',
  );
  lines.push(
    '- **Subagent cards:** the seeded history contains 24 children, but the replay streaming scenario drives one session. Concurrent child streaming and sibling re-render isolation are not measured.',
  );
  lines.push(
    '- **Long tasks during scroll:** zero tasks >50 ms does not establish smoothness. Work below that threshold or missing observer entries can still accompany dropped rAF frames.',
  );
  lines.push('');
  lines.push('## Reproduce');
  lines.push('');
  lines.push('Build the baseline and candidate worktrees configured in `tools/gui-bench-run.ts`, then run on a Linux desktop host:');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run gui-bench:run -- --runs 3');
  lines.push('```');
  lines.push('');
  lines.push('Raw per-run JSON: `/opt/cursor/artifacts/gui_bench_raw.json`.');
  lines.push('Seed manifest: `/opt/cursor/artifacts/gui_bench_seed_manifest.json`.');
  lines.push('Screenshots: `/opt/cursor/artifacts/gui_bench_*_run*.png`.');
  return `${lines.join('\n')}\n`;
}
