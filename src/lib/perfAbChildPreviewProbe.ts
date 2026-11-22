import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AbProbeMetric } from './perfAbProbes';
import type { ChildSessionSummary } from '@droidex/protocol';
import type { ChildSessionActivity } from './childSessions';
import type { ChildStreamSnapshot } from './childSessionStream';

const CHILDREN = 27;
const ANSWER_BYTES = 720_000;
const RUNS = 11;

interface ChildStreamModule {
  projectChildStreamSnapshots: (
    children: readonly ChildSessionSummary[],
    activityFor: (child: ChildSessionSummary) => ChildSessionActivity | undefined,
    interruptReason?: string,
    previous?: ReadonlyMap<string, ChildStreamSnapshot>,
  ) => ReadonlyMap<string, ChildStreamSnapshot>;
}

export async function measureChildPreviews(treeRoot: string): Promise<AbProbeMetric[]> {
  const streamPath = join(treeRoot, 'src/lib/childSessionStream.ts');
  const ids = ['childPreview.unchangedProjectionMs', 'childPreview.unchangedOneLineProjectionMs'];
  if (!existsSync(streamPath)) {
    return ids.map((id) => metric(id, NaN, 'childSessionStream.ts missing'));
  }
  const stream = (await import(pathToFileURL(streamPath).href)) as ChildStreamModule;
  const line = `${'output token stream '.repeat(4).slice(0, 71)}\n`;
  return [
    metric(
      ids[0],
      medianProjectionMs(stream, line.repeat(ANSWER_BYTES / line.length)),
      '72-char lines',
    ),
    metric(ids[1], medianProjectionMs(stream, 'x'.repeat(ANSWER_BYTES)), 'a single line'),
  ];
}

function medianProjectionMs(stream: ChildStreamModule, answer: string): number {
  const children = Array.from({ length: CHILDREN }, (_, index) =>
    runningChild(`child-${String(index)}`),
  );
  const activity: ChildSessionActivity = {
    status: 'running',
    startedAt: 1,
    latest: { kind: 'text', text: answer },
  };
  const activityFor = () => activity;
  const previous = stream.projectChildStreamSnapshots(children, activityFor);
  const durations: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    stream.projectChildStreamSnapshots(children, activityFor, undefined, previous);
    durations.push(performance.now() - started);
  }
  return durations.sort((a, b) => a - b)[Math.floor(RUNS / 2)];
}

function runningChild(childSessionId: string): ChildSessionSummary {
  return {
    childSessionId,
    parentAppSessionId: 'parent',
    role: 'worker',
    modelId: 'model',
    transcriptAvailable: true,
    spawnLink: { kind: 'tool-use', id: `tool-${childSessionId}` },
    startedAt: 1,
    streamFidelity: 'token',
    status: 'running',
  };
}

function metric(id: string, value: number, answerShape: string): AbProbeMetric {
  return {
    id,
    value,
    unit: 'ms',
    method: `median of ${String(RUNS)} re-projections of ${String(CHILDREN)} unchanged running children, each with a ${String(ANSWER_BYTES)}-byte answer of ${answerShape}`,
  };
}
