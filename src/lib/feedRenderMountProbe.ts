// Mount-level cross-validation of the comparator probe: the same multi-agent
// burst drives real mounted FeedItemView rows through react-dom against the
// probe DOM shim. The harness replicates ChatView's hook semantics with real
// React — the activity callback is a useCallback keyed on [childSessions,
// transcript], the agent monitor a useMemo keyed on [childSessions, snapshots]
// — so prop identities emerge from React itself instead of a hand-maintained
// model. Renders are counted by wrapping the memo object's compare: every
// comparator evaluation inside a measured flushSync window is recorded with
// its outcome, and a false outcome is the re-render React performs. Nested
// rows inside worked folds evaluate through the same memo type, so they are
// counted with production-faithful reachability (only when the fold renders).
//
// The domShim import must stay first: it installs the window/document globals
// before react-dom's module scope reads them.
import './domShim';
import { createElement, useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type { ChildSessionSummary, TranscriptEvent } from '@droidex/protocol';
import type { ChildSessionActivity, ChildSessionTarget } from './childSessions';
import type { ChildStreamSnapshot } from './childSessionStream';
import { createProbeContainer } from './domShim';
import {
  emptyRowRenderCounts,
  loadFeedProbeTree,
  multiAgentStreamingScenario,
  type FeedRenderProbeOptions,
  type RowRenderCounts,
} from './feedRenderProbe';

export interface MountProbeResult {
  options: FeedRenderProbeOptions;
  commitsMeasured: number;
  republishTicks: number;
  // Mean actual re-renders (comparator returned false) per transcript commit.
  meanPerCommit: RowRenderCounts;
  meanPerRepublishTick: RowRenderCounts;
  // Mean memo comparator invocations per commit: the rows React reached.
  evaluationsPerCommit: number;
  rendersPerSecond: number;
  wallMs: number;
  notes: string[];
}

interface MountPass {
  transcript: TranscriptEvent[];
  mutation: unknown;
  retainedCost: number;
  childSessions: ChildSessionSummary[];
  shownSnapshots: ReadonlyMap<string, ChildStreamSnapshot> | undefined;
}

interface CompareRecord {
  itemType: string;
  equal: boolean;
}

const PARENT = 'parent-session';

function countRecord(counts: RowRenderCounts, itemType: string): void {
  if (itemType === 'child_sessions') counts.waveCards += 1;
  else if (itemType === 'child_session') counts.spawnLines += 1;
  else if (itemType === 'message') counts.messages += 1;
  else counts.other += 1;
  counts.total += 1;
}

function addCounts(target: RowRenderCounts, add: RowRenderCounts): void {
  target.waveCards += add.waveCards;
  target.spawnLines += add.spawnLines;
  target.messages += add.messages;
  target.other += add.other;
  target.mounts += add.mounts;
  target.total += add.total;
}

function divideCounts(counts: RowRenderCounts, divisor: number): RowRenderCounts {
  return {
    waveCards: counts.waveCards / divisor,
    spawnLines: counts.spawnLines / divisor,
    messages: counts.messages / divisor,
    other: counts.other / divisor,
    mounts: counts.mounts / divisor,
    total: counts.total / divisor,
  };
}

export async function measureFeedRendersMounted(
  options: FeedRenderProbeOptions,
): Promise<MountProbeResult> {
  const tree = await loadFeedProbeTree(options.treeRoot);
  const scenario = multiAgentStreamingScenario(options);
  const notes: string[] = [];

  const feedItemView = tree.FeedItemView as {
    compare?: (prev: never, next: never) => boolean;
  };
  if (typeof feedItemView.compare !== 'function') {
    throw new Error('FeedItemView memo object or its compare missing in the measured tree');
  }

  // Ground-truth instrumentation: count every comparator evaluation React
  // performs inside a measured pass, with its outcome. The wrapper delegates
  // to the tree's own feedItemPropsEqual, so behavior is unchanged.
  let records: CompareRecord[] | null = null;
  const originalCompare = feedItemView.compare;
  feedItemView.compare = ((prev: never, next: never) => {
    const equal = originalCompare(prev, next);
    if (records !== null) {
      const itemType = (next as { item?: { type?: string } }).item?.type ?? 'unknown';
      records.push({ itemType, equal });
    }
    return equal;
  });

  let root: ReturnType<typeof createRoot> | undefined;
  try {
    const stableHandler = () => undefined;
    const models = Object.freeze([
      { id: 'probe-model', displayName: 'Probe model', label: 'Probe model' },
    ]) as never;

    // The harness replicates ChatView + MessageFeed narrowed to the row list:
    // same useCallback/useMemo dependency semantics, same inline projector call,
    // same keyed rows. Virtualization is not modeled — it decides which rows
    // mount, not how mounted rows memoize, which is what round 1 changed.
    function Harness({ pass }: { pass: MountPass }) {
      const projectorRef = useRef<ReturnType<typeof tree.createChatFeedProjector> | null>(null);
      projectorRef.current ??= tree.createChatFeedProjector();
      const activity = useCallback(
        (target: ChildSessionTarget) =>
          tree.childSessionActivityForTarget(pass.childSessions, pass.transcript, target),
        [pass.childSessions, pass.transcript],
      );
      const agentMonitor = useMemo(
        () =>
          options.dock
            ? { sessions: pass.childSessions, models, snapshots: pass.shownSnapshots }
            : undefined,
        [pass.childSessions, pass.shownSnapshots, models],
      );
      const projection = projectorRef.current({
        conversationKey: `${PARENT}:primary`,
        allTranscript: pass.transcript,
        transcriptMutation: pass.mutation,
        childSessionId: null,
        pending: true,
        retainedCost: pass.retainedCost,
        options: {
          childSessionCards: true,
          changes: true,
          groupChildSessions: options.dock,
          foldLiveTurn: false,
        },
      });
      const poll =
        tree.trailingSubagentPoll(projection.visibleTranscript, options.dock) !== undefined;
      const lastIndex = projection.feedItems.length - 1;
      return createElement(
        'div',
        null,
        ...projection.feedItems.map((item, index) =>
          createElement(feedItemView as never, {
            key: item.key,
            item,
            live: index === lastIndex && !poll,
            sessionLive: true,
            compacting: false,
            cwd: 'probe-cwd',
            onOpenDiff: stableHandler,
            onOpenReviewFile: stableHandler,
            onOpenChildSession: stableHandler,
            onOpenAgent: stableHandler,
            childSessionActivity: activity,
            agentMonitor,
            liveTiming: true,
            isFinalResponse: false,
            isLatestReply: false,
            density: 'balanced',
            inlineDiffs: true,
          } as never),
        ),
      );
    }

    // Store-shaped mutable state, replaced immutably per commit — same rules as
    // the comparator probe's driver.
    let transcript: TranscriptEvent[] = [];
    let retainedCost = 0;
    let mutation: unknown;
    let childSessions = [...scenario.historicalChildren, ...scenario.children];

    const ingest = (events: readonly TranscriptEvent[]): void => {
      const ingested = tree.ingestTranscriptEvents(transcript, retainedCost, events);
      if (!ingested.change) return;
      transcript = ingested.events;
      retainedCost = ingested.estimatedCost;
      mutation = tree.nextTranscriptMutation(mutation, ingested.change);
    };

    let projectedSnapshots: ReadonlyMap<string, ChildStreamSnapshot> | undefined;
    let pendingSnapshots: ReadonlyMap<string, ChildStreamSnapshot> | undefined;
    let shownSnapshots: ReadonlyMap<string, ChildStreamSnapshot> | undefined;
    const activityForChild = (child: ChildSessionSummary): ChildSessionActivity | undefined => {
      if (child.spawnLink?.kind !== 'tool-use') {
        return { status: child.status, startedAt: child.startedAt };
      }
      return (
        tree.childSessionActivityForTarget(childSessions, transcript, {
          toolUseId: child.spawnLink.id,
          childSessionId: child.childSessionId,
          ...(child.label !== undefined ? { label: child.label } : {}),
        }) ?? { status: child.status, startedAt: child.startedAt }
      );
    };
    const projectSnapshots = (): void => {
      projectedSnapshots = tree.projectChildStreamSnapshots(
        childSessions,
        activityForChild,
        undefined,
        projectedSnapshots,
      );
      pendingSnapshots = projectedSnapshots;
    };

    ingest(scenario.setupEvents);
    projectSnapshots();
    shownSnapshots = pendingSnapshots;

    const passState = (): MountPass => ({
      transcript,
      mutation,
      retainedCost,
      childSessions,
      shownSnapshots,
    });

    // Mount the harness once with the post-setup state; the initial mount cost
    // is not part of the measurement, matching the comparator probe.
    const container = createProbeContainer();
    let push: ((pass: MountPass) => void) | undefined;
    function Root() {
      const [pass, setPass] = useState(passState);
      push = setPass;
      return createElement(Harness, { pass });
    }
    const mounted = createRoot(container as never);
    root = mounted;
    flushSync(() => {
      mounted.render(createElement(Root));
    });
    if (push === undefined) throw new Error('harness failed to mount');
    const pushPass = push;

    // One measured render pass: a flushSync state push with the records window
    // open, so every comparator evaluation React performs is attributed.
    const runPass = (
      pass: MountPass,
      totals: RowRenderCounts,
      evaluations: { count: number },
    ): void => {
      records = [];
      flushSync(() => {
        pushPass(pass);
      });
      const counted = records;
      records = null;
      const counts = emptyRowRenderCounts();
      for (const record of counted) {
        evaluations.count += 1;
        if (!record.equal) countRecord(counts, record.itemType);
      }
      addCounts(totals, counts);
    };

    const started = performance.now();
    const commitTotals = emptyRowRenderCounts();
    const tickTotals = emptyRowRenderCounts();
    const evaluations = { count: 0 };
    let commitEvaluations = 0;
    let clock = 0;
    let nextFrame = options.frameMs;
    let tickCount = 0;
    for (const commit of scenario.commits) {
      clock += options.commitMs;
      while (nextFrame <= clock) {
        nextFrame += options.frameMs;
        if (pendingSnapshots !== undefined && pendingSnapshots !== shownSnapshots) {
          shownSnapshots = pendingSnapshots;
          runPass(passState(), tickTotals, { count: 0 });
          tickCount += 1;
        }
      }
      if (commit.settling.length > 0) {
        childSessions = childSessions.map((child) =>
          commit.settling.includes(child.childSessionId)
            ? { ...child, status: 'completed' as const, settledAt: clock }
            : child,
        );
      }
      ingest(commit.events);
      projectSnapshots();
      const before = evaluations.count;
      runPass(passState(), commitTotals, evaluations);
      commitEvaluations += evaluations.count - before;
    }
    const wallMs = performance.now() - started;

    notes.push(
      'mount-level measurement: real mounted rows; comparator evaluations counted through the memo compare wrapper',
    );
    const burstSeconds = clock / 1000;
    return {
      options,
      commitsMeasured: scenario.commits.length,
      republishTicks: tickCount,
      meanPerCommit: divideCounts(commitTotals, scenario.commits.length),
      meanPerRepublishTick: tickCount > 0 ? divideCounts(tickTotals, tickCount) : emptyRowRenderCounts(),
      evaluationsPerCommit: commitEvaluations / scenario.commits.length,
      rendersPerSecond: (commitTotals.total + tickTotals.total) / burstSeconds,
      wallMs,
      notes,
    };
  } finally {
    feedItemView.compare = originalCompare;
    root?.unmount();
  }
}
