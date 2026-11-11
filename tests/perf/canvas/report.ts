// The canvas scenario's Markdown: per board, the counts each gesture's frames
// cost and their timing, each as the median of the runs with its spread.

import type { GestureSample } from './measure';

export interface GestureSummary {
  description: string;
  median: GestureSample;
  min: GestureSample;
  max: GestureSample;
}

export interface CanvasReport {
  measuredAt: string;
  treeRoot: string;
  runs: number;
  environment: { browser: string; platform: string; cpu: string };
  /** By board size, then gesture. */
  boards: Record<string, Record<string, GestureSummary>>;
  metrics: { id: string; value: number; unit: string; method: string }[];
}

type Column = [header: string, field: keyof GestureSample, digits: number];

const COUNTS: Column[] = [
  ['Frames', 'frames', 0],
  ['Commits/frame', 'commitsPerFrame', 2],
  ['Renders/frame', 'rendersPerFrame', 0],
  ['Layout reads/frame', 'layoutReadsPerFrame', 1],
  ['Forced styles/frame', 'forcedStylesPerFrame', 2],
  ['Forced layouts/frame', 'forcedLayoutsPerFrame', 2],
  ['Raster tasks/frame', 'rasterTasksPerFrame', 1],
  ['Long tasks', 'longTasks', 0],
  ['Longest task ms', 'longestTaskMs', 0],
];

const TIMING: Column[] = [
  ['Busy p50 ms', 'busyP50Ms', 1],
  ['Busy p95 ms', 'busyP95Ms', 1],
  ['Busy p99 ms', 'busyP99Ms', 1],
  ['Share over 8.3 ms', 'overBudgetShare', 2],
  ['Script ms', 'scriptMsPerFrame', 1],
  ['Style ms', 'styleMsPerFrame', 1],
  ['Layout ms', 'layoutMsPerFrame', 1],
  ['Paint ms', 'paintMsPerFrame', 1],
  ['rAF p50 ms', 'rafP50Ms', 1],
  ['rAF p95 ms', 'rafP95Ms', 1],
  ['rAF p99 ms', 'rafP99Ms', 1],
  ['Dropped frames', 'droppedFrames', 0],
];

export function renderCanvasReport(report: CanvasReport): string {
  const lines = [
    '# Canvas perf scenario',
    '',
    `- Date: ${report.measuredAt}`,
    `- Tree: \`${report.treeRoot}\``,
    `- ${report.environment.browser} on ${report.environment.platform} (${report.environment.cpu})`,
    `- ${String(report.runs)} runs; each cell is the median, with the least and greatest run when they differ.`,
    '- Input is paced at 8.33 ms. Busy is main-thread task time per frame, from a traced stream; script, style, layout and paint are its parts, per frame.',
    '- rAF is the gap between animation frames in ms, from an untraced stream; headless Chromium draws at 60 Hz, so 16.7 ms is a frame on time.',
    '',
  ];
  for (const [frames, gestures] of Object.entries(report.boards)) {
    lines.push(`## ${frames} frames`, '', '### Counts', '', ...table(gestures, COUNTS), '');
    lines.push('### Timing', '', ...table(gestures, TIMING), '');
  }
  lines.push(
    '## Gate metrics',
    '',
    '| Metric | Value | Unit | Method |',
    '| --- | --- | --- | --- |',
  );
  for (const metric of report.metrics)
    lines.push(
      `| \`${metric.id}\` | ${round(metric.value, 3)} | ${metric.unit} | ${metric.method} |`,
    );
  lines.push('');
  return lines.join('\n');
}

function table(gestures: Record<string, GestureSummary>, columns: Column[]): string[] {
  return [
    `| Gesture | ${columns.map(([header]) => header).join(' | ')} |`,
    `| --- |${' --- |'.repeat(columns.length)}`,
    ...Object.entries(gestures).map(
      ([name, summary]) =>
        `| ${name} | ${columns.map(([, field, digits]) => cell(summary, field, digits)).join(' | ')} |`,
    ),
  ];
}

function cell(summary: GestureSummary, field: keyof GestureSample, digits: number): string {
  const median = round(summary.median[field], digits);
  const min = round(summary.min[field], digits);
  const max = round(summary.max[field], digits);
  return min === max ? median : `${median} (${min}–${max})`;
}

function round(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}
