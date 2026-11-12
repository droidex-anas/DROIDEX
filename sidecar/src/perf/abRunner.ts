import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  candidateReplayMetrics,
  diffProbes,
  type AbProbeResult,
  type BaselineCache,
  type ComparisonReport,
} from './abCompare.js';
import { evaluateProbeGates, mergeGateEvaluations } from './gates.js';
import { runSoak, sessionSwitchTick } from './lifecycle.js';
import { METRIC_CATALOG } from './metricKind.js';
import { runReplay } from './runner.js';
import { resolveScenario, SKIPPED_PERF_SCENARIOS } from './scenario.js';

export const DEFAULT_BASELINE_REF = 'origin/main';
export const DEFAULT_COMPARE_SCENARIOS = [
  'smoke',
  'idle',
  'streaming',
  'agents-4',
  'agents-16',
  'agents-27',
  'multi-agent',
  'long-tail',
  'session-switch',
  'soak',
] as const;

const GATE_SCENARIOS = ['smoke', 'soak'] as const;

// tests/perf/canvas/run.ts exits with this when Playwright's Chromium is not installed.
const CANVAS_CHROMIUM_MISSING_EXIT = 3;

export interface CompareOptions {
  baselineRef: string;
  refreshBaseline: boolean;
  skipBundle: boolean;
  includeBaseline: boolean;
  scenarios: readonly string[];
  candidateRoot: string;
}

export function defaultCandidateRoot(): string {
  return resolve(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), '..');
}

function baselineCachePath(candidateRoot: string): string {
  return join(candidateRoot, 'sidecar/src/perf/baselines/origin-main.json');
}

export async function runComparison(options: CompareOptions): Promise<ComparisonReport> {
  const candidateRoot = options.candidateRoot;
  const baselineCommit = options.includeBaseline
    ? git(candidateRoot, ['rev-parse', options.baselineRef]).trim()
    : '';
  const candidateCommit = git(candidateRoot, ['rev-parse', 'HEAD']).trim();
  const cache = options.includeBaseline ? readCache(baselineCachePath(candidateRoot)) : null;
  // A cache that measured another commit, ref or set of A/B metrics is stale.
  const cacheMatches =
    cache !== null &&
    cache.baselineCommit === baselineCommit &&
    cache.baselineRef === options.baselineRef &&
    JSON.stringify(cache.abMetricIds) === JSON.stringify(abMetricIds());
  const cacheHit = options.includeBaseline && !options.refreshBaseline && cacheMatches;

  let baselineProbes: AbProbeResult | null = cacheHit ? cache.probes : null;
  if (options.includeBaseline && !cacheHit) {
    baselineProbes = measureBaselineTree(
      candidateRoot,
      options.baselineRef,
      baselineCommit,
      options.skipBundle,
    );
    const nextCache: BaselineCache = {
      baselineRef: options.baselineRef,
      baselineCommit,
      abMetricIds: abMetricIds(),
      measuredAt: new Date().toISOString(),
      probes: baselineProbes,
    };
    const cachePath = baselineCachePath(candidateRoot);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(nextCache, null, 2)}\n`);
  }

  if (!options.skipBundle) ensureViteBuild(candidateRoot);
  ensureSidecarBuild(candidateRoot);
  const candidateProbes = runProbes(candidateRoot, candidateRoot);
  const probeMetrics = diffProbes(baselineProbes, candidateProbes);
  const candidateReplays: ComparisonReport['candidateReplays'] = [];
  for (const name of options.scenarios) {
    const spec = resolveScenario(name);
    if (spec.kind === 'soak') candidateReplays.push(await runSoak(spec));
    else if (spec.kind === 'session-switch') {
      candidateReplays.push(await runReplay({ spec, onWaitTick: sessionSwitchTick(spec) }));
    } else {
      candidateReplays.push(await runReplay({ spec }));
    }
  }

  const probeGates = evaluateProbeGates({
    mountedRowsAt10k: metricValue(candidateProbes, 'feed.mountedRowsAt10k'),
    rowVisitsPerTailDeltaAt10k: metricValue(candidateProbes, 'feed.rowVisitsPerTailDeltaAt10k'),
    eventsRebuiltPerDelta: metricValue(candidateProbes, 'feed.eventsRebuiltPerDelta'),
    terminalDeliveriesPerFlood: metricValue(candidateProbes, 'terminal.deliveriesPerFlood'),
    livePrimarySessionsAfterSoak:
      candidateReplays.find((report) => report.scenario.kind === 'soak')?.sidecar.resources
        ?.livePrimarySessions ?? null,
    reactCommitsPerPanFrame: metricValue(candidateProbes, 'canvas.reactCommitsPerPanFrame'),
    reactCommitsPerZoomFrame: metricValue(candidateProbes, 'canvas.reactCommitsPerZoomFrame'),
    reactCommitsPerDragFrame: metricValue(candidateProbes, 'canvas.reactCommitsPerDragFrame'),
    layoutReadsPerPanFrame: metricValue(candidateProbes, 'canvas.layoutReadsPerPanFrame'),
    longTasksDuringGestures: metricValue(candidateProbes, 'canvas.longTasksDuringGestures'),
    panBusyP95Ms: metricValue(candidateProbes, 'canvas.panBusyP95Ms'),
    panOverBudgetShare: metricValue(candidateProbes, 'canvas.panOverBudgetShare'),
    panRafP95Ms: metricValue(candidateProbes, 'canvas.panRafP95Ms'),
  });
  const replayGates = candidateReplays.map((report) => report.gates);

  return {
    baselineRef: options.baselineRef,
    baselineCommit,
    candidateCommit,
    candidateTree: candidateRoot,
    baselineStale: options.includeBaseline && cache !== null && !cacheMatches,
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${process.platform}/${process.arch}` },
    probes: { baseline: baselineProbes, candidate: candidateProbes },
    metrics: [...probeMetrics, ...candidateReplayMetrics(candidateReplays)],
    candidateReplays,
    gates: mergeGateEvaluations([probeGates, ...replayGates]),
    skippedScenarios: SKIPPED_PERF_SCENARIOS,
  };
}

export async function runGateSuite(candidateRoot: string): Promise<ComparisonReport> {
  return runComparison({
    baselineRef: DEFAULT_BASELINE_REF,
    refreshBaseline: false,
    skipBundle: true,
    includeBaseline: false,
    scenarios: GATE_SCENARIOS,
    candidateRoot,
  });
}

function measureBaselineTree(
  candidateRoot: string,
  baselineRef: string,
  baselineCommit: string,
  skipBundle: boolean,
): AbProbeResult {
  const worktree = join('/tmp', `droidex-perf-baseline-${baselineCommit.slice(0, 12)}`);
  if (!existsSync(worktree)) {
    git(candidateRoot, ['worktree', 'add', '--detach', worktree, baselineCommit]);
    linkModules(candidateRoot, worktree);
  }
  if (!skipBundle) ensureViteBuild(worktree);
  ensureSidecarBuild(worktree);
  const probes = runProbes(candidateRoot, worktree);
  return { ...probes, treeRoot: `${baselineRef}@${baselineCommit}` };
}

function runProbes(candidateRoot: string, treeRoot: string): AbProbeResult {
  const script = join(candidateRoot, 'tools/perf-ab-probes.ts');
  const output = execFileSync(process.execPath, ['--import', 'tsx', script, treeRoot], {
    encoding: 'utf8',
    cwd: candidateRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const probes = JSON.parse(output) as AbProbeResult;
  const canvas = runCanvasScenario(candidateRoot, treeRoot);
  return {
    ...probes,
    metrics: [...probes.metrics, ...canvas.metrics],
    notes: [...probes.notes, ...canvas.notes],
  };
}

/**
 * This branch's canvas scenario against the tree's board harness, one run on
 * the 30-frame board. A machine without Playwright's Chromium, or a tree
 * without the harness, leaves the canvas metrics unmeasured and says why; any
 * other failure of the scenario fails the run.
 */
function runCanvasScenario(
  candidateRoot: string,
  treeRoot: string,
): Pick<AbProbeResult, 'metrics' | 'notes'> {
  if (!existsSync(join(treeRoot, 'tests/smoke/board/index.html'))) {
    return {
      metrics: [],
      notes: ['canvas scenario unmeasured: the tree has no tests/smoke/board.'],
    };
  }
  const script = join(candidateRoot, 'tests/perf/canvas/run.ts');
  const args = ['--import', 'tsx', script, '--tree', treeRoot, '--frames', '30', '--runs', '1'];
  const result = spawnSync(process.execPath, [...args, '--metrics'], {
    encoding: 'utf8',
    cwd: candidateRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status === CANVAS_CHROMIUM_MISSING_EXIT) {
    return {
      metrics: [],
      notes: [
        "canvas scenario unmeasured: Playwright's Chromium is not installed (npx playwright install chromium).",
      ],
    };
  }
  if (result.status !== 0) {
    throw new Error(
      `The canvas scenario failed on ${treeRoot} (${result.signal ?? `exit ${String(result.status)}`}).`,
    );
  }
  return { metrics: JSON.parse(result.stdout) as AbProbeResult['metrics'], notes: [] };
}

function ensureViteBuild(treeRoot: string): void {
  if (existsSync(join(treeRoot, 'dist/index.html'))) return;
  execFileSync(process.execPath, [join(treeRoot, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: treeRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
}

function ensureSidecarBuild(treeRoot: string): void {
  const entry = join(treeRoot, 'sidecar/dist/sidecar.mjs');
  const worker = join(treeRoot, 'sidecar/dist/historyPersistenceWorker.mjs');
  if (existsSync(entry) && existsSync(worker)) return;
  execFileSync('npm', ['run', 'build', '--prefix', join(treeRoot, 'sidecar')], {
    cwd: treeRoot,
    stdio: 'inherit',
  });
}

function linkModules(candidateRoot: string, worktree: string): void {
  const rootModules = join(candidateRoot, 'node_modules');
  const sidecarModules = join(candidateRoot, 'sidecar/node_modules');
  if (!existsSync(join(worktree, 'node_modules')) && existsSync(rootModules)) {
    execFileSync('ln', ['-s', rootModules, join(worktree, 'node_modules')]);
  }
  if (!existsSync(join(worktree, 'sidecar/node_modules')) && existsSync(sidecarModules)) {
    execFileSync('ln', ['-s', sidecarModules, join(worktree, 'sidecar/node_modules')]);
  }
}

function abMetricIds(): string[] {
  return METRIC_CATALOG.filter((metric) => metric.class === 'ab').map((metric) => metric.id);
}

function readCache(path: string): BaselineCache | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as BaselineCache;
}

function metricValue(result: AbProbeResult, id: string): number | null {
  const value = result.metrics.find((metric) => metric.id === id)?.value;
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
