import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { measureFeedRenders, type FeedRenderProbeResult } from '../src/lib/feedRenderProbe.ts';
import {
  measureFeedRendersMounted,
  type MountProbeResult,
} from '../src/lib/feedRenderMountProbe.ts';

/* Comparator-level render probe for the multi-agent streaming feed. Measures
   one tree per process run; pass --baseline to compare two trees side by side
   (typically a pre-round-1 worktree against this one):

     git worktree add ../renderer-probe-base <pre-round-1-commit>
     ln -s "$(pwd)/node_modules" ../renderer-probe-base/node_modules
     node --import tsx tools/feed-render-probe.ts --baseline ../renderer-probe-base
 */

interface Cli {
  baseline?: string;
  candidate: string;
  commits: number;
  commitMs: number;
  frameMs: number;
  seed: number;
  out: string;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    candidate: process.cwd(),
    commits: 200,
    commitMs: 16,
    frameMs: 16.67,
    seed: 11,
    out: join(process.cwd(), 'reports', 'feed-render-probe.md'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    switch (argv[index]) {
      case '--baseline':
        cli.baseline = value;
        index += 1;
        break;
      case '--candidate':
        cli.candidate = value;
        index += 1;
        break;
      case '--commits':
        cli.commits = Number(value);
        index += 1;
        break;
      case '--commit-ms':
        cli.commitMs = Number(value);
        index += 1;
        break;
      case '--frame-ms':
        cli.frameMs = Number(value);
        index += 1;
        break;
      case '--seed':
        cli.seed = Number(value);
        index += 1;
        break;
      case '--out':
        cli.out = value;
        index += 1;
        break;
      default:
        throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  return cli;
}

function cell(value: number): string {
  return value.toFixed(2);
}

function ratio(before: number, after: number): string {
  if (after === 0) return before === 0 ? '1.00×' : '—';
  return `${(before / after).toFixed(2)}×`;
}

function meanTable(
  title: string,
  rows: { label: string; before?: FeedRenderProbeResult; after: FeedRenderProbeResult }[],
  pick: (result: FeedRenderProbeResult) => {
    waveCards: number;
    spawnLines: number;
    messages: number;
    other: number;
    total: number;
  },
): string {
  const lines = [
    `### ${title}`,
    '',
    '| Configuration | Wave cards | Spawn lines | Messages | Other | Total |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const row of rows) {
    for (const [tree, result] of [
      ['before', row.before],
      ['after', row.after],
    ] as const) {
      if (!result) continue;
      const mean = pick(result);
      lines.push(
        `| ${row.label} · ${tree} | ${cell(mean.waveCards)} | ${cell(mean.spawnLines)} | ${cell(mean.messages)} | ${cell(mean.other)} | ${cell(mean.total)} |`,
      );
    }
    if (row.before) {
      const beforeMean = pick(row.before);
      const afterMean = pick(row.after);
      lines.push(
        `| ${row.label} · reduction | ${ratio(beforeMean.waveCards, afterMean.waveCards)} | ${ratio(beforeMean.spawnLines, afterMean.spawnLines)} | ${ratio(beforeMean.messages, afterMean.messages)} | ${ratio(beforeMean.other, afterMean.other)} | ${ratio(beforeMean.total, afterMean.total)} |`,
      );
    }
  }
  return lines.join('\n');
}

const cli = parseArgs(process.argv.slice(2));

const configurations: { children: number; dock: boolean; label: string }[] = [
  { children: 4, dock: true, label: '4 children · dock (wave cards)' },
  { children: 8, dock: true, label: '8 children · dock (wave cards)' },
  { children: 4, dock: false, label: '4 children · no dock (spawn lines)' },
  { children: 8, dock: false, label: '8 children · no dock (spawn lines)' },
];

interface ConfigRow {
  label: string;
  before?: FeedRenderProbeResult;
  after: FeedRenderProbeResult;
  mountBefore?: MountProbeResult;
  mountAfter?: MountProbeResult;
  mountFailures: string[];
}

// A mount-level failure is reportable data about the shim's fidelity, not a
// fatal error: the comparator-level numbers still stand.
async function tryMount(
  options: Parameters<typeof measureFeedRendersMounted>[0],
): Promise<{ result?: MountProbeResult; failure?: string }> {
  try {
    return { result: await measureFeedRendersMounted(options) };
  } catch (error) {
    return { failure: (error as Error).message.split('\n')[0].slice(0, 120) };
  }
}

const rows: ConfigRow[] = [];
for (const config of configurations) {
  const probeOptions = (treeRoot: string) => ({
    treeRoot,
    children: config.children,
    commits: cli.commits,
    commitMs: cli.commitMs,
    frameMs: cli.frameMs,
    dock: config.dock,
    seed: cli.seed,
  });
  const after = await measureFeedRenders(probeOptions(cli.candidate));
  const mountAttemptAfter = await tryMount(probeOptions(cli.candidate));
  const before = cli.baseline ? await measureFeedRenders(probeOptions(cli.baseline)) : undefined;
  const mountAttemptBefore = cli.baseline
    ? await tryMount(probeOptions(cli.baseline))
    : { result: undefined };
  const mountFailures: string[] = [];
  if (mountAttemptAfter.failure !== undefined)
    mountFailures.push(`${config.label} · after: ${mountAttemptAfter.failure}`);
  if (mountAttemptBefore.failure !== undefined)
    mountFailures.push(`${config.label} · before: ${mountAttemptBefore.failure}`);
  rows.push({
    label: config.label,
    before,
    after,
    ...(mountAttemptBefore.result !== undefined ? { mountBefore: mountAttemptBefore.result } : {}),
    ...(mountAttemptAfter.result !== undefined ? { mountAfter: mountAttemptAfter.result } : {}),
    mountFailures,
  });
}

const report: string[] = [
  '# Feed render probe: multi-agent streaming',
  '',
  `Candidate tree: ${cli.candidate}`,
  cli.baseline ? `Baseline tree: ${cli.baseline}` : 'No baseline tree; candidate-only run.',
  '',
  `Scenario: one parent session, two settled turns (one nesting a completed wave), then a live`,
  `turn with N workers. ${cli.commits} transcript commits at ${cli.commitMs}ms intervals (the store's`,
  `16ms bridge batching window saturated), each appending token deltas for one or two active`,
  `children, occasional child tool calls, occasional parent narration. Half the children settle`,
  `mid-burst, one more at the three-quarter mark. Snapshot republishes follow a ${cli.frameMs}ms`,
  `animation-frame grid and drive their own render passes, as they do in production.`,
  '',
  'A counted render is a memo comparator (`feedItemPropsEqual` of the measured tree) returning',
  'false for a mounted row, with React semantics: comparisons run against the props of the row’s',
  'last actual render, and rows inside a fold only evaluate when the fold itself re-renders.',
  'Mounts are counted separately. Timer-driven self re-renders (elapsed timers, streaming carets)',
  'are time-based, identical across trees, and excluded.',
  '',
  meanTable('Re-renders per transcript commit (mean)', rows, (result) => result.meanPerCommit),
  '',
  meanTable('Re-renders per snapshot-republish tick (mean)', rows, (result) => result.meanPerRepublishTick),
  '',
  '### Rendered rows per second (both streams integrated)',
  '',
  '| Configuration | Before | After | Reduction |',
  '|---|---:|---:|---:|',
  ...rows.map((row) => {
    const after = row.after.rendersPerSecond;
    if (!row.before) return `| ${row.label} | — | ${after.toFixed(0)} | — |`;
    const before = row.before.rendersPerSecond;
    return `| ${row.label} | ${before.toFixed(0)} | ${after.toFixed(0)} | ${ratio(before, after)} |`;
  }),
  '',
  '### Mount-level cross-validation',
  '',
  'The same burst driven through real mounted rows (react-dom against a minimal DOM shim),',
  'with renders counted by instrumenting the memo compare React itself evaluates. The harness',
  'replicates ChatView’s hook semantics — the activity callback and agent monitor identities',
  'emerge from real useCallback/useMemo — so this stream validates the prop modeling of the',
  'comparator probe end to end. Mounts are not counted here, so the comparator column excludes',
  'them (mean total minus mean mounts).',
  '',
  '| Configuration | Tree | Per commit: comparator | Per commit: mounted | Per tick: comparator | Per tick: mounted |',
  '|---|---|---:|---:|---:|---:|',
  ...rows.flatMap((row) => {
    const lines: string[] = [];
    for (const [tree, comparator, mounted] of [
      ['before', row.before, row.mountBefore],
      ['after', row.after, row.mountAfter],
    ] as const) {
      if (!comparator || !mounted) continue;
      const comparatorCommit = comparator.meanPerCommit.total - comparator.meanPerCommit.mounts;
      const comparatorTick = comparator.meanPerRepublishTick.total - comparator.meanPerRepublishTick.mounts;
      lines.push(
        `| ${row.label} · ${tree} | ${cell(comparatorCommit)} | ${cell(mounted.meanPerCommit.total)} | ${cell(comparatorTick)} | ${cell(mounted.meanPerRepublishTick.total)} |`,
      );
    }
    return lines;
  }),
  '',
  rows.some((row) => row.mountFailures.length > 0)
    ? `### Mount-level configurations that escaped the shim\n\n${rows
        .flatMap((row) => row.mountFailures)
        .map((failure) => `- ${failure}`)
        .join('\n')}\n\nThese are shim fidelity limits, not measured production behavior; the comparator-level\nrows above stand for those configurations.`
    : 'All configurations completed at mount level.',
  '',
  '### Context',
  '',
  '| Configuration | Rows in feed | Initial mounts | Republish ticks |',
  '|---|---:|---:|---:|',
  ...rows.map(
    (row) =>
      `| ${row.label} | ${String(row.after.rowsInFeed)} | ${String(row.after.initialMounts)} | ${String(row.after.republishTicks)} |`,
  ),
  '',
].join('\n');

mkdirSync(dirname(cli.out), { recursive: true });
writeFileSync(cli.out, report);
process.stdout.write(`${report}\n`);
