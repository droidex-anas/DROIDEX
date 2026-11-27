import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';

import type { ChildSessionSummary, TranscriptEvent } from '@droidex/protocol';
import type { ChildSessionActivity, ChildSessionTarget } from './childSessions';
import type { FeedItem } from '../components/chatFeed';
import type { ChildStreamSnapshot } from './childSessionStream';

// Files loaded from another git worktree sit outside this package's tsconfig
// jsx setting; classic JSX in those graphs needs React in scope.
(globalThis as { React?: typeof React }).React = React;

/* ── Probe model ──────────────────────────────────────────────────────────
   A comparator-level measurement: for every store commit of a simulated
   multi-agent streaming burst, the probe builds the feed exactly the way
   ChatView does (same ingestion, same mutation threading, same incremental
   projector), constructs the props MessageFeed would hand each row, and
   evaluates the tree's own `feedItemPropsEqual` for every row the commit
   reaches. A failed comparison is the re-render React would perform.
   React.memo compares against the props of the row's last actual render,
   not the previous commit, and rows inside a fold only re-evaluate when the
   fold itself re-renders — the row state machine below mirrors both rules.
   Timer-driven self re-renders (elapsed timers, streaming carets) are
   time-based, identical across trees, and not counted here. */

export interface FeedRenderProbeOptions {
  treeRoot: string;
  children: number;
  commits: number;
  // Store commits arrive at most once per 16ms bridge-action batching window;
  // a saturated burst hits that bound. Snapshot republishes follow the
  // animation frame grid.
  commitMs: number;
  frameMs: number;
  // Dock on: contiguous spawns render as one wave card (the normal chat
  // view). Dock off: per-spawn lines (Mission Control style), no monitor.
  dock: boolean;
  seed: number;
}

export interface RowRenderCounts {
  waveCards: number;
  spawnLines: number;
  messages: number;
  other: number;
  mounts: number;
  total: number;
}

export interface FeedRenderProbeResult {
  options: FeedRenderProbeOptions;
  commitsMeasured: number;
  // Frame-driven render passes where the throttled snapshot map republished.
  republishTicks: number;
  initialMounts: number;
  rowsInFeed: number;
  // Mean comparator-failed re-renders per transcript commit during the burst.
  meanPerCommit: RowRenderCounts;
  // Mean re-renders per snapshot-republish render pass.
  meanPerRepublishTick: RowRenderCounts;
  // Both render streams integrated over the burst duration.
  rendersPerSecond: number;
  totals: RowRenderCounts;
  tickTotals: RowRenderCounts;
  // Worst single render pass of each stream, for tail-cost visibility.
  maxPerCommit: RowRenderCounts;
  maxPerRepublishTick: RowRenderCounts;
  notes: string[];
}

interface TreeModules {
  feedItemPropsEqual: (prev: object, next: object) => boolean;
  // The memo object itself, for mount-level instrumentation: its compare is
  // feedItemPropsEqual and React re-reads the property every evaluation.
  FeedItemView: unknown;
  childSessionActivityForTarget: (
    childSessions: readonly ChildSessionSummary[],
    allTx: readonly TranscriptEvent[],
    target: ChildSessionTarget,
  ) => ChildSessionActivity | undefined;
  ingestTranscriptEvents: (
    previous: TranscriptEvent[],
    previousCost: number,
    incoming: readonly TranscriptEvent[],
  ) => {
    events: TranscriptEvent[];
    estimatedCost: number;
    change: { kind: string; previousLength: number; firstChangedIndex: number } | undefined;
  };
  nextTranscriptMutation: (previous: unknown, change: unknown) => unknown;
  createChatFeedProjector: () => (input: {
    conversationKey: string;
    allTranscript: TranscriptEvent[];
    transcriptMutation: unknown;
    childSessionId: string | null;
    pending: boolean;
    retainedCost: number;
    options: object;
  }) => { feedItems: FeedItem[]; visibleTranscript: TranscriptEvent[] };
  projectChildStreamSnapshots: (
    children: readonly ChildSessionSummary[],
    activityFor: (child: ChildSessionSummary) => ChildSessionActivity | undefined,
    interruptReason?: string,
    previous?: ReadonlyMap<string, ChildStreamSnapshot>,
  ) => ReadonlyMap<string, ChildStreamSnapshot>;
  trailingSubagentPoll: (
    events: TranscriptEvent[],
    grouped: boolean,
  ) => TranscriptEvent | undefined;
}

async function importTree<T>(treeRoot: string, relativePath: string): Promise<T> {
  return (await import(pathToFileURL(join(treeRoot, relativePath)).href)) as T;
}

export async function loadFeedProbeTree(treeRoot: string): Promise<TreeModules> {
  const chatPath = join(treeRoot, 'src/components/chat.tsx');
  if (!existsSync(chatPath)) throw new Error(`chat.tsx missing in ${treeRoot}`);
  const chat = await importTree<{
    feedItemPropsEqual: TreeModules['feedItemPropsEqual'];
    FeedItemView: unknown;
  }>(treeRoot, 'src/components/chat.tsx');
  const childSessions = await importTree<{
    childSessionActivityForTarget: TreeModules['childSessionActivityForTarget'];
  }>(treeRoot, 'src/lib/childSessions.ts');
  const ingestion = await importTree<{
    ingestTranscriptEvents: TreeModules['ingestTranscriptEvents'];
  }>(treeRoot, 'src/lib/transcriptIngestion.ts');
  const mutation = await importTree<{
    nextTranscriptMutation: TreeModules['nextTranscriptMutation'];
  }>(treeRoot, 'src/lib/transcriptMutation.ts');
  const projector = await importTree<{
    createChatFeedProjector: TreeModules['createChatFeedProjector'];
  }>(treeRoot, 'src/components/chatFeedProjector.ts');
  const stream = await importTree<{
    projectChildStreamSnapshots: TreeModules['projectChildStreamSnapshots'];
  }>(treeRoot, 'src/lib/childSessionStream.ts');
  const turns = await importTree<{
    trailingSubagentPoll: TreeModules['trailingSubagentPoll'];
  }>(treeRoot, 'src/components/chatFeedTurns.ts');
  return {
    feedItemPropsEqual: chat.feedItemPropsEqual,
    FeedItemView: chat.FeedItemView,
    childSessionActivityForTarget: childSessions.childSessionActivityForTarget,
    ingestTranscriptEvents: ingestion.ingestTranscriptEvents,
    nextTranscriptMutation: mutation.nextTranscriptMutation,
    createChatFeedProjector: projector.createChatFeedProjector,
    projectChildStreamSnapshots: stream.projectChildStreamSnapshots,
    trailingSubagentPoll: turns.trailingSubagentPoll,
  };
}

/* ── Scenario generation ──────────────────────────────────────────────────
   A parent session with two settled turns (one nesting a completed wave, so
   historical folds with waves are exercised), then a live turn that spawned
   N workers. The burst interleaves token deltas for one or two active
   children per commit, occasional child tool calls, and occasional parent
   narration — the shape the 16ms store batching window delivers during
   parallel streaming. Children settle in two waves mid-burst. */

const PARENT = 'parent-session';
const TOKEN_WORDS = [
  'implement',
  'the',
  'cache',
  'layer',
  'with',
  'a',
  'bounded',
  'eviction',
  'policy',
  'and',
  'write-through',
  'semantics',
  'covering',
  'expiry',
  'races',
];

export interface ProbeCommit {
  events: TranscriptEvent[];
  // Children reaching 'completed' at this commit.
  settling: string[];
}

export interface ProbeScenario {
  setupEvents: TranscriptEvent[];
  children: ChildSessionSummary[];
  // The turn-2 historical wave entries, already completed.
  historicalChildren: ChildSessionSummary[];
  commits: ProbeCommit[];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function eventFactory() {
  let seq = 0;
  let clock = 1_000;
  return {
    ts: () => (clock += 37),
    next: (extra: Partial<TranscriptEvent>): TranscriptEvent => {
      seq += 1;
      return {
        id: `ev-${String(seq)}`,
        appSessionId: PARENT,
        sourceSessionId: 'primary',
        role: 'primary',
        ts: clock,
        kind: 'text',
        ...extra,
      };
    },
  };
}

function tokenText(random: () => number): string {
  const words = 2 + Math.floor(random() * 4);
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) {
    out.push(TOKEN_WORDS[Math.floor(random() * TOKEN_WORDS.length)] ?? 'token');
  }
  return ` ${out.join(' ')}`;
}

function spawnPair(
  factory: ReturnType<typeof eventFactory>,
  index: number,
  wavePrefix: string,
): { call: TranscriptEvent; result: TranscriptEvent; toolUseId: string; label: string } {
  const label = `${wavePrefix}-worker-${String(index)}`;
  const toolUseId = `spawn-${wavePrefix}-${String(index)}`;
  const call = factory.next({
    kind: 'tool_call',
    toolName: 'Task',
    toolArgs: { subagent_type: label, description: `Validate slice ${String(index)} of the cache` },
    toolUseId,
    ts: factory.ts(),
  });
  const result = factory.next({
    kind: 'tool_result',
    toolUseId,
    text: `Spawned child session for ${label}`,
    ts: factory.ts(),
  });
  return { call, result, toolUseId, label };
}

function childSummary(
  spawn: { toolUseId: string; label: string },
  childSessionId: string,
  startedAt: number,
  status: ChildSessionSummary['status'],
): ChildSessionSummary {
  return {
    parentAppSessionId: PARENT,
    childSessionId,
    role: 'worker',
    status,
    label: spawn.label,
    prompt: 'Validate the slice',
    modelId: 'probe-model',
    spawnLink: { kind: 'tool-use', id: spawn.toolUseId },
    transcriptAvailable: true,
    startedAt,
    streamFidelity: 'token',
  };
}

export function multiAgentStreamingScenario(options: {
  children: number;
  commits: number;
  seed: number;
}): ProbeScenario {
  const random = mulberry32(options.seed);
  const factory = eventFactory();
  const setupEvents: TranscriptEvent[] = [];
  const push = (...events: TranscriptEvent[]) => {
    setupEvents.push(...events);
  };

  // Turn 1: an ordinary settled turn with tool work.
  push(
    factory.next({
      author: 'user',
      sourceSessionId: 'user',
      text: 'Implement the cache layer',
      ts: factory.ts(),
    }),
  );
  push(factory.next({ text: 'Reading the existing store first.', ts: factory.ts() }));
  push(
    factory.next({
      kind: 'tool_call',
      toolName: 'Grep',
      toolArgs: { pattern: 'cache' },
      toolUseId: 'tool-grep-1',
      ts: factory.ts(),
    }),
  );
  push(
    factory.next({
      kind: 'tool_result',
      toolUseId: 'tool-grep-1',
      text: 'src/lib/cache.ts',
      ts: factory.ts(),
    }),
  );
  push(
    factory.next({
      text: 'The store is a flat map; the cache can sit beside it.',
      ts: factory.ts(),
    }),
  );

  // Turn 2: a settled wave of three validators, folded into history.
  push(
    factory.next({
      author: 'user',
      sourceSessionId: 'user',
      text: 'Fan out three validators',
      ts: factory.ts(),
    }),
  );
  push(factory.next({ text: 'Spawning three validators.', ts: factory.ts() }));
  const historicalChildren: ChildSessionSummary[] = [];
  for (let index = 0; index < 3; index += 1) {
    const spawn = spawnPair(factory, index, 'old');
    push(spawn.call, spawn.result);
    historicalChildren.push(
      childSummary(spawn, `old-child-${String(index)}`, spawn.call.ts, 'completed'),
    );
  }
  for (const child of historicalChildren) {
    push(
      factory.next({
        sourceSessionId: child.childSessionId,
        role: 'worker',
        text: 'slice validated, no discrepancies in the eviction ordering',
        ts: factory.ts(),
      }),
    );
  }
  push(factory.next({ text: 'All three validators agree the ordering holds.', ts: factory.ts() }));

  // Turn 3 (live): the measured wave.
  push(
    factory.next({
      author: 'user',
      sourceSessionId: 'user',
      text: `Now fan out ${String(options.children)} workers on the full matrix`,
      ts: factory.ts(),
    }),
  );
  push(factory.next({ text: `Spawning ${String(options.children)} workers.`, ts: factory.ts() }));
  const children: ChildSessionSummary[] = [];
  for (let index = 0; index < options.children; index += 1) {
    const spawn = spawnPair(factory, index, 'live');
    push(spawn.call, spawn.result);
    children.push(childSummary(spawn, `live-child-${String(index)}`, spawn.call.ts, 'running'));
  }

  // The burst. Each child streams one growing native text item at a time;
  // a tool call ends the item and the next delta opens a fresh message id.
  const messageIds = new Map<string, number>();
  const commits: ProbeCommit[] = [];
  const active = children.map((child) => child.childSessionId);
  const firstSettleCount = Math.max(1, Math.floor(active.length / 2));
  const firstSettleAt = Math.floor(options.commits / 2);
  const secondSettleAt = Math.floor((options.commits * 3) / 4);
  let cursor = 0;
  let primaryMessageId = 0;
  for (let commit = 0; commit < options.commits; commit += 1) {
    const events: TranscriptEvent[] = [];
    const settling: string[] = [];
    const emitters = 1 + Math.floor(random() * 2);
    for (let count = 0; count < emitters && active.length > 0; count += 1) {
      const childSessionId = active[cursor % active.length];
      cursor += 1;
      if (random() < 0.14) {
        events.push(
          factory.next({
            kind: 'tool_call',
            toolName: 'Read',
            toolArgs: { path: `src/lib/cache/slice-${childSessionId}.ts` },
            toolUseId: `tooluse-${childSessionId}-${String(commit)}`,
            sourceSessionId: childSessionId,
            role: 'worker',
            ts: factory.ts(),
          }),
        );
        messageIds.set(childSessionId, (messageIds.get(childSessionId) ?? 0) + 1);
      } else {
        const messageId = `msg-${childSessionId}-${String(messageIds.get(childSessionId) ?? 0)}`;
        events.push(
          factory.next({
            kind: 'text',
            text: tokenText(random),
            textUpdate: { messageId, kind: 'delta' },
            sourceSessionId: childSessionId,
            role: 'worker',
            ts: factory.ts(),
          }),
        );
      }
    }
    // The parent narrates occasionally — a primary-visible row that must
    // legitimately re-render, anchoring the baseline cost of a commit.
    if (commit % 5 === 4) {
      if (commit % 20 === 19) primaryMessageId += 1;
      events.push(
        factory.next({
          kind: 'text',
          text: tokenText(random),
          textUpdate: { messageId: `msg-primary-${String(primaryMessageId)}`, kind: 'delta' },
          sourceSessionId: 'primary',
          role: 'primary',
          ts: factory.ts(),
        }),
      );
    }
    if (commit === firstSettleAt) settling.push(...active.splice(0, firstSettleCount));
    if (commit === secondSettleAt && active.length > 1) settling.push(active.splice(0, 1)[0]);
    commits.push({ events, settling });
  }
  return { setupEvents, children, historicalChildren, commits };
}

/* ── Measurement ── */

// The state of one mounted row as React sees it: the props of its last
// actual render (memo compares against these, not last commit's), and for a
// worked fold the nested rows in the same shape, frozen until the fold
// re-renders and re-evaluates them.
interface RowState {
  props: Record<string, unknown>;
  children?: Map<string, RowState>;
}

export function emptyRowRenderCounts(): RowRenderCounts {
  return { waveCards: 0, spawnLines: 0, messages: 0, other: 0, mounts: 0, total: 0 };
}

function emptyCounts(): RowRenderCounts {
  return { waveCards: 0, spawnLines: 0, messages: 0, other: 0, mounts: 0, total: 0 };
}

function countRender(counts: RowRenderCounts, item: FeedItem): void {
  if (item.type === 'child_sessions') counts.waveCards += 1;
  else if (item.type === 'child_session') counts.spawnLines += 1;
  else if (item.type === 'message') counts.messages += 1;
  else counts.other += 1;
  counts.total += 1;
}

function countMount(counts: RowRenderCounts): void {
  counts.mounts += 1;
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

function maxCounts(target: RowRenderCounts, candidate: RowRenderCounts): void {
  target.waveCards = Math.max(target.waveCards, candidate.waveCards);
  target.spawnLines = Math.max(target.spawnLines, candidate.spawnLines);
  target.messages = Math.max(target.messages, candidate.messages);
  target.other = Math.max(target.other, candidate.other);
  target.mounts = Math.max(target.mounts, candidate.mounts);
  target.total = Math.max(target.total, candidate.total);
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

// Nested rows render inside the fold with live forced off and without the
// top-level-only flags; everything else passes through from the fold's props,
// exactly as FeedItemView's worked branch constructs them.
function nestedProps(foldProps: Record<string, unknown>, child: FeedItem): Record<string, unknown> {
  return {
    ...foldProps,
    item: child,
    live: false,
    liveTiming: undefined,
    compacting: undefined,
    isFinalResponse: undefined,
    isLatestReply: undefined,
    onFork: undefined,
    forkPointId: undefined,
    forking: undefined,
  };
}

export async function measureFeedRenders(
  options: FeedRenderProbeOptions,
): Promise<FeedRenderProbeResult> {
  const tree = await loadFeedProbeTree(options.treeRoot);
  const scenario = multiAgentStreamingScenario(options);
  const notes: string[] = [];

  // Stable handler identities: MessageFeed ref-stabilizes these, so they are
  // constant across commits in production and constant here.
  const stableHandler = () => undefined;
  const models = Object.freeze({ 'probe-model': { label: 'Probe model' } });

  // Store-shaped mutable state, replaced immutably per commit.
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

  const project = tree.createChatFeedProjector();
  const projectFeed = () =>
    project({
      conversationKey: `${PARENT}:primary`,
      allTranscript: transcript,
      transcriptMutation: mutation,
      childSessionId: null,
      pending: true,
      retainedCost,
      options: {
        childSessionCards: true,
        changes: true,
        groupChildSessions: options.dock,
        foldLiveTurn: false,
      },
    });

  // Frame-throttled snapshot stream, mirroring useChildStreamSnapshots plus
  // useFrameThrottledValue: the map projects synchronously per commit and
  // republishes on the animation-frame grid when it changed.
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

  // agentMonitor identity: useMemo over [childSessions, models, snapshots].
  let monitorDeps: readonly unknown[] = [];
  let agentMonitor: { sessions: unknown; models: unknown; snapshots: unknown } | undefined;
  const currentAgentMonitor = () => {
    if (!options.dock) return undefined;
    const deps = [childSessions, models, shownSnapshots] as const;
    if (agentMonitor === undefined || deps.some((dep, index) => dep !== monitorDeps[index])) {
      monitorDeps = deps;
      agentMonitor = { sessions: childSessions, models, snapshots: shownSnapshots };
    }
    return agentMonitor;
  };

  // The commit's activity callback: closes over the transcript and child
  // sessions values as of this commit, the way the production useCallback
  // closes over its render-scope bindings — a fresh identity per commit that
  // still scans the state of its own commit when the comparator invokes it.
  const activityClosure = () => {
    const capturedChildren = childSessions;
    const capturedTranscript = transcript;
    return (target: ChildSessionTarget) =>
      tree.childSessionActivityForTarget(capturedChildren, capturedTranscript, target);
  };

  // Per-commit props, mirroring MessageFeed's row mapping. Values that are
  // constant in production during a burst are constant here; they cannot
  // affect comparator outcomes either way.
  const rowProps = (
    item: FeedItem,
    index: number,
    lastIndex: number,
    subagentPoll: boolean,
    activity: (target: ChildSessionTarget) => ChildSessionActivity | undefined,
  ): Record<string, unknown> => ({
    item,
    live: index === lastIndex && !subagentPoll,
    sessionLive: true,
    compacting: false,
    cwd: 'probe-cwd',
    onOpenDiff: stableHandler,
    onOpenReviewFile: stableHandler,
    onOpenChildSession: stableHandler,
    onOpenAgent: stableHandler,
    childSessionActivity: activity,
    agentMonitor: currentAgentMonitor(),
    liveTiming: true,
    specContent: undefined,
    isFinalResponse: false,
    isLatestReply: false,
    density: 'balanced',
    inlineDiffs: true,
  });

  // Mount a row and everything inside it: a fresh row renders once, and a
  // worked fold's nested rows mount with it.
  const mountRow = (
    item: FeedItem,
    props: Record<string, unknown>,
    counts: RowRenderCounts,
  ): RowState => {
    countMount(counts);
    if (item.type !== 'worked') return { props };
    const children = new Map<string, RowState>();
    for (const child of item.items) {
      children.set(child.key, mountRow(child, nestedProps(props, child), counts));
    }
    return { props, children };
  };

  // Re-evaluate one row against its previous render state. A skipped row
  // keeps its last-rendered props and frozen children; a re-rendered worked
  // fold re-evaluates its nested rows against their own frozen states.
  const evaluateRow = (
    item: FeedItem,
    props: Record<string, unknown>,
    before: RowState | undefined,
    counts: RowRenderCounts,
  ): RowState => {
    if (before === undefined) return mountRow(item, props, counts);
    if (tree.feedItemPropsEqual(before.props, props)) {
      return {
        props: before.props,
        ...(before.children ? { children: before.children } : {}),
      };
    }
    countRender(counts, item);
    if (item.type !== 'worked') return { props };
    const children = new Map<string, RowState>();
    for (const child of item.items) {
      children.set(
        child.key,
        evaluateRow(child, nestedProps(props, child), before.children?.get(child.key), counts),
      );
    }
    return { props, children };
  };

  // Prime: ingest the setup transcript, project, and treat every row as the
  // initial mount (reported separately, never in per-commit means).
  ingest(scenario.setupEvents);
  projectSnapshots();
  const initialProjection = projectFeed();
  const initialActivity = activityClosure();
  const initialCounts = emptyCounts();
  const initialPoll =
    tree.trailingSubagentPoll(initialProjection.visibleTranscript, options.dock) !== undefined;
  const initialRows = new Map<string, RowState>();
  initialProjection.feedItems.forEach((item, index) => {
    initialRows.set(
      item.key,
      mountRow(
        item,
        rowProps(item, index, initialProjection.feedItems.length - 1, initialPoll, initialActivity),
        initialCounts,
      ),
    );
  });
  // useFrameThrottledValue seeds the shown value at mount; republishes only
  // happen once the projected map moves away from this first publication.
  shownSnapshots = pendingSnapshots;

  // One React render pass over the feed: every mounted top-level row
  // re-evaluates its memo comparison against the props of its last render.
  // The feed rows themselves are unchanged across a republish tick (the
  // transcript did not move, so the projector returns its cache), which the
  // shared `feedItems`/`activity` inputs capture: a tick rebuilds the same
  // props with a fresh monitor identity, a commit rebuilds everything.
  let rows = initialRows;
  const renderPass = (
    feedItems: readonly FeedItem[],
    activity: (target: ChildSessionTarget) => ChildSessionActivity | undefined,
    poll: boolean,
    counts: RowRenderCounts,
  ): void => {
    const nextRows = new Map<string, RowState>();
    feedItems.forEach((item, index) => {
      nextRows.set(
        item.key,
        evaluateRow(
          item,
          rowProps(item, index, feedItems.length - 1, poll, activity),
          rows.get(item.key),
          counts,
        ),
      );
    });
    rows = nextRows;
  };

  // The burst, as two interleaved render streams on one clock. Transcript
  // commits land every commitMs (the store's 16ms batching window saturated).
  // Snapshot republishes follow the animation-frame grid: a frame publishes
  // the pending map when it changed, which re-renders the chat view with a
  // fresh monitor identity but the same transcript — separate React renders
  // in production, separate passes here.
  const commitTotals = emptyCounts();
  const commitMaxima = emptyCounts();
  const tickTotals = emptyCounts();
  const tickMaxima = emptyCounts();
  let clock = 0;
  let nextFrame = options.frameMs;
  let tickCount = 0;
  let projection = initialProjection;
  let activity = initialActivity;
  let poll = initialPoll;
  for (const commit of scenario.commits) {
    clock += options.commitMs;
    while (nextFrame <= clock) {
      nextFrame += options.frameMs;
      if (pendingSnapshots !== undefined && pendingSnapshots !== shownSnapshots) {
        shownSnapshots = pendingSnapshots;
        const counts = emptyCounts();
        renderPass(projection.feedItems, activity, poll, counts);
        addCounts(tickTotals, counts);
        maxCounts(tickMaxima, counts);
        tickCount += 1;
      }
    }

    // Lifecycle: settled children get fresh entry objects in a fresh array,
    // mirroring the store's immutable SESSION_CHILD reduction.
    if (commit.settling.length > 0) {
      childSessions = childSessions.map((child) =>
        commit.settling.includes(child.childSessionId)
          ? { ...child, status: 'completed' as const, settledAt: clock }
          : child,
      );
    }

    ingest(commit.events);
    projectSnapshots();
    projection = projectFeed();
    activity = activityClosure();
    poll = tree.trailingSubagentPoll(projection.visibleTranscript, options.dock) !== undefined;
    const counts = emptyCounts();
    renderPass(projection.feedItems, activity, poll, counts);
    addCounts(commitTotals, counts);
    maxCounts(commitMaxima, counts);
  }

  if (!options.dock) {
    notes.push(
      'dock disabled: per-spawn lines carry no agent monitor; comparator outcomes are activity-driven only',
    );
  }
  const burstSeconds = clock / 1000;
  return {
    options,
    commitsMeasured: scenario.commits.length,
    republishTicks: tickCount,
    initialMounts: initialCounts.mounts,
    rowsInFeed: rows.size,
    meanPerCommit: divideCounts(commitTotals, scenario.commits.length),
    meanPerRepublishTick: tickCount > 0 ? divideCounts(tickTotals, tickCount) : emptyCounts(),
    rendersPerSecond: (commitTotals.total + tickTotals.total) / burstSeconds,
    totals: commitTotals,
    tickTotals,
    maxPerCommit: commitMaxima,
    maxPerRepublishTick: tickMaxima,
    notes,
  };
}
