// The canvas perf scenario: every gesture on a 30- and a 100-frame board of
// the tree's board harness, in headless Chromium at real timers, repeated
// `--runs` times. Writes reports/perf/canvas.{json,md}; with `--metrics` it
// prints only the gate metrics, which perf:compare and perf:gates read. It
// exits with status 3 when Playwright's Chromium is not installed.
//
//   npm run perf:canvas -- [--runs 3] [--frames 30,100] [--gesture pan] [--tree <root>] [--metrics]

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { serveHarness } from './board';
import { GESTURES } from './gestures';
import { measureGesture, type GestureSample } from './measure';
import { renderCanvasReport, type CanvasReport, type GestureSummary } from './report';

/** Perf gates report the canvas metrics unmeasured, not failed, on this exit status. */
const CHROMIUM_MISSING_EXIT = 3;

interface Options {
  treeRoot: string;
  runs: number;
  frames: number[];
  gestures: string[];
  metricsOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    treeRoot: process.cwd(),
    runs: 3,
    frames: [30, 100],
    gestures: GESTURES.map((gesture) => gesture.name),
    metricsOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv.at(++index);
      if (next === undefined) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === '--tree') options.treeRoot = resolve(value());
    else if (arg === '--runs') options.runs = Number(value());
    else if (arg === '--frames') options.frames = value().split(',').map(Number);
    else if (arg === '--gesture') options.gestures = value().split(',');
    else if (arg === '--metrics') options.metricsOnly = true;
    else throw new Error(`Unknown argument "${arg}".`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1)
    throw new Error('--runs takes a whole number.');
  // The grid always holds designs A and B.
  if (options.frames.some((frames) => !Number.isInteger(frames) || frames < 2))
    throw new Error('--frames takes whole numbers of at least 2.');
  for (const name of options.gestures)
    if (!GESTURES.some((gesture) => gesture.name === name))
      throw new Error(`No gesture is named "${name}".`);
  return options;
}

async function runScenario(options: Options): Promise<CanvasReport> {
  const browser = await launchChromium();
  const harness = await serveHarness(options.treeRoot);
  const samples = new Map<string, GestureSample[]>();
  try {
    for (let run = 1; run <= options.runs; run += 1) {
      for (const frames of options.frames) {
        for (const gesture of GESTURES.filter(({ name }) => options.gestures.includes(name))) {
          console.error(
            `run ${String(run)}/${String(options.runs)}: ${gesture.name} on ${String(frames)} frames`,
          );
          const key = `${String(frames)}/${gesture.name}`;
          samples.set(key, [
            ...(samples.get(key) ?? []),
            await measureGesture(browser, harness.url, frames, gesture),
          ]);
        }
      }
    }
    const boards: CanvasReport['boards'] = {};
    for (const [key, runs] of samples) {
      const [frames, name] = key.split('/');
      const gesture = GESTURES.find((each) => each.name === name);
      boards[frames] ??= {};
      boards[frames][name] = { description: gesture?.description ?? '', ...summarize(runs) };
    }
    return {
      measuredAt: new Date().toISOString(),
      treeRoot: options.treeRoot,
      runs: options.runs,
      environment: {
        browser: `Chromium ${browser.version()} headless`,
        platform: `${process.platform}/${process.arch}`,
        cpu: cpus()[0]?.model ?? 'unknown',
      },
      boards,
      metrics: gateMetrics(boards),
    };
  } finally {
    await browser.close();
    await harness.close();
  }
}

/** Exits with CHROMIUM_MISSING_EXIT when Playwright's Chromium is not installed. */
async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Executable doesn't exist"))
      throw error;
    console.error(error.message.split('\n')[0]);
    process.exit(CHROMIUM_MISSING_EXIT);
  }
}

/** The median, least and greatest of each field over the runs. */
function summarize(runs: GestureSample[]): Omit<GestureSummary, 'description'> {
  const fields = Object.keys(runs[0]) as (keyof GestureSample)[];
  const pick = (choose: (values: number[]) => number) =>
    Object.fromEntries(
      fields.map((field) => [field, choose(runs.map((run) => run[field]))]),
    ) as unknown as GestureSample;
  return {
    median: pick((values) => {
      const sorted = values.toSorted((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }),
    min: pick((values) => Math.min(...values)),
    max: pick((values) => Math.max(...values)),
  };
}

/** What perf gates read: counts are hard gates, milliseconds only warn. */
function gateMetrics(boards: CanvasReport['boards']): CanvasReport['metrics'] {
  const pan = boards['30']?.pan?.median;
  const board = boards['30'] ?? {};
  const longTasks = Object.values(board).reduce(
    (sum, gesture) => sum + gesture.median.longTasks,
    0,
  );
  const method = '30-frame board, background pan, median of the runs';
  if (!pan) return [];
  return [
    { id: 'canvas.reactCommitsPerPanFrame', value: pan.commitsPerFrame, unit: 'commits', method },
    { id: 'canvas.layoutReadsPerPanFrame', value: pan.layoutReadsPerFrame, unit: 'reads', method },
    {
      id: 'canvas.longTasksDuringGestures',
      value: longTasks,
      unit: 'tasks',
      method: `30-frame board, tasks over 50 ms across ${String(Object.keys(board).length)} gestures, median per gesture`,
    },
    { id: 'canvas.panBusyP95Ms', value: pan.busyP95Ms, unit: 'ms', method },
    { id: 'canvas.panOverBudgetShare', value: pan.overBudgetShare, unit: 'ratio', method },
    { id: 'canvas.panRafP95Ms', value: pan.rafP95Ms, unit: 'ms', method },
  ];
}

const options = parseArgs(process.argv.slice(2));
const report = await runScenario(options);
if (options.metricsOnly) {
  process.stdout.write(`${JSON.stringify(report.metrics)}\n`);
} else {
  const outDir = join(process.cwd(), 'reports/perf');
  mkdirSync(outDir, { recursive: true });
  const markdown = renderCanvasReport(report);
  writeFileSync(join(outDir, 'canvas.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'canvas.md'), markdown);
  console.log(markdown);
  console.log(`Artifacts: ${join(outDir, 'canvas.json')}`);
}
