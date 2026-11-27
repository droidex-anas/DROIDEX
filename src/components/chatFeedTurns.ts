import { feedItemTailId } from '../hooks/conversationViewportAnchor';
import { promptDisplayText } from '../lib/composePrompt';
import { classifyEvent } from '../lib/transcript';
import type { TranscriptEvent } from '@droidex/protocol';
import {
  buildFeed,
  collectTurnFiles,
  isCancellationArtifact,
  isCompactingStatus,
  isCompactionDivider,
  isSteeredPrompt,
  startsTurn,
  type BuildFeedOptions,
  type FeedItem,
} from './chatFeed';
import { isAutomationProposalCall } from '../features/automations/toolNames';
import { isThreadSpawnCall } from '../features/projects/threadToolNames';

function isTurnBoundary(item: FeedItem): boolean {
  return (item.type === 'message' || item.type === 'status') && startsTurn(item.event);
}

function isHarnessModelSwitch(item: FeedItem): boolean {
  return item.type === 'status' && item.event.modelSwitch?.cause !== undefined;
}

// Short preview of a message for the conversation timeline tooltip: whitespace
// (including newlines) is collapsed to single spaces so the hover reads as one
// flowing horizontal snippet, capped in length so a large prompt can't produce
// a huge tooltip.
function turnLabel(text?: string): string {
  if (!text) return 'Message';
  const label = promptDisplayText(text);
  if (!label) return 'Message';
  return label.length > 160 ? `${label.slice(0, 160).trimEnd()}…` : label;
}

// The start of the reply under a prompt in the timeline preview, with Markdown
// emphasis and code marks dropped so it reads as plain text.
function replySnippet(text: string): string {
  const snippet = text.replace(/[`*#]/g, '').replace(/\s+/g, ' ').trim();
  return snippet.length > 160 ? `${snippet.slice(0, 160).trimEnd()}…` : snippet;
}

export interface ConversationAnchor {
  id: string;
  label: string;
  reply?: string;
}

// One anchor per user prompt for the conversation timeline: the tick previews the
// prompt and the first reply message under it, and scrolls that prompt to the
// top. Anchoring on prompts keeps the tick count exactly equal to the number of
// prompts (a leading model/spec message no longer adds a stray tick).
export function promptAnchorsFromItems(items: FeedItem[]): ConversationAnchor[] {
  const out: ConversationAnchor[] = [];
  for (const it of items) {
    if (it.type !== 'message') continue;
    if (it.event.author === 'user') {
      out.push({ id: it.key, label: turnLabel(it.event.text) });
      continue;
    }
    const current = out.at(-1);
    if (current && current.reply === undefined && it.event.text) {
      current.reply = replySnippet(it.event.text) || undefined;
    }
  }
  return out;
}

// The subagent poll call the transcript currently ends on, if any. The dock
// suppresses these calls (the wave card speaks for them), so the tail the user
// sees is an earlier, already-finished step: without this the feed shimmers a
// settled row while the parent's real work — checking on its subagents — goes
// unannounced. Returning the call also lets the cue time the check itself.
export function trailingSubagentPoll(
  events: TranscriptEvent[],
  grouped: boolean,
): TranscriptEvent | undefined {
  if (!grouped) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (isCancellationArtifact(e)) continue;
    if (e.kind === 'tool_call') return isSubagentPoll(e) ? e : undefined;
    if (e.kind !== 'tool_result' || !e.toolUseId) return undefined;
    // A replayed result carries no toolName, so correlate it back to its call —
    // scanning backward from the result, since the call is always just behind it
    // and a forward scan would walk the whole transcript on every render.
    for (let j = i - 1; j >= 0; j--) {
      const call = events[j];
      if (call.kind !== 'tool_call' || call.toolUseId !== e.toolUseId) continue;
      return isSubagentPoll(call) ? call : undefined;
    }
    return undefined;
  }
  return undefined;
}

// The provider marks a call that polls or stops an agent it is tracking; the
// tool's name alone never says so.
function isSubagentPoll(event: TranscriptEvent): boolean {
  return Boolean(event.pollsChildSessionId);
}

// Build the grouped feed once so callers can share it (the chat view derives
// timeline anchors from the same items it hands to MessageFeed, instead of
// running buildFeed/groupTurns a second time on every render and switch).
export type GroupedFeedOptions = BuildFeedOptions & {
  specContent?: string;
  changes?: boolean;
  // Compact tool activity: the running turn folds as it goes instead of
  // listing every step.
  foldLiveTurn?: boolean;
  // Settled turns fold into "Worked for …" groups. Surfaces that read an
  // agent's steps verbatim (the agent pane) pass false; the grouping-only
  // options above then have no effect.
  foldTurns?: boolean;
};

export function buildGroupedFeed(
  events: TranscriptEvent[],
  pending: boolean,
  {
    specContent,
    changes = false,
    foldLiveTurn = false,
    foldTurns = true,
    ...feedOptions
  }: GroupedFeedOptions = {},
): FeedItem[] {
  const items = buildFeed(events, feedOptions);
  if (!foldTurns) return items;
  return groupTurns(items, pending, specContent, changes, foldLiveTurn);
}

// Best-effort end timestamp of a feed item, used to time the live working cue.
export function tailTimestamp(item?: FeedItem): number | undefined {
  if (!item) return undefined;
  if (item.type === 'worked' || item.type === 'turnChanges') return undefined;
  if (item.type === 'tools') {
    if (item.events.length === 0) return undefined;
    const e = item.events[item.events.length - 1];
    return e.endTs ?? e.ts;
  }
  if (item.type === 'diffs') {
    if (item.changes.length === 0) return undefined;
    const c = item.changes[item.changes.length - 1];
    return c.event.endTs ?? c.event.ts;
  }
  if (item.type === 'child_sessions' || item.type === 'browser') {
    const e = item.events.at(-1);
    return e?.endTs ?? e?.ts;
  }
  return item.event.endTs ?? item.event.ts;
}

// Earliest start and latest end timestamps across a set of feed items.
function spanOf(items: FeedItem[]): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  const consider = (ts?: number, endTs?: number) => {
    if (ts == null) return;
    start = Math.min(start, ts);
    end = Math.max(end, endTs ?? ts);
  };
  for (const it of items) {
    if (it.type === 'tools')
      it.events.forEach((e) => {
        consider(e.ts, e.endTs);
      });
    else if (it.type === 'diffs')
      it.changes.forEach((c) => {
        consider(c.event.ts, c.event.endTs);
      });
    else if (it.type === 'child_sessions' || it.type === 'browser')
      it.events.forEach((e) => {
        consider(e.ts, e.endTs);
      });
    else if (it.type !== 'worked' && it.type !== 'turnChanges')
      consider(it.event.ts, it.event.endTs);
  }
  if (start === Infinity) return { start: 0, end: 0 };
  return { start, end };
}

// A folded activity item that is purely todo/plan reconciliation (no real tool
// work). Used to decide whether two assistant text fragments are actually one
// final answer split by an internal checklist update. The group must contain a
// plan update and otherwise hold only its own successful results: an id-less
// TodoWrite result classifies as generic tool_activity, so accepting successful
// results keeps `assistant -> TodoWrite -> result -> assistant` a single answer,
// while a failed result keeps the messages distinct so the failure surfaces.
function isReconciliationItem(it: FeedItem): boolean {
  if (it.type !== 'tools') return false;
  let hasPlan = false;
  for (const e of it.events) {
    if (classifyEvent(e) === 'plan_update') {
      hasPlan = true;
      continue;
    }
    if (e.kind === 'tool_result' && !e.isError) continue;
    return false;
  }
  return hasPlan;
}

// What the voice read out, not the turn's written answer: it never becomes the
// answer, never merges into one, and never folds away.
function isSpokenLine(it: FeedItem): boolean {
  return it.type === 'message' && it.event.spoken === true;
}

// Join a trailing assistant fragment back onto the running final answer.
function mergeAssistantMessages(
  prev: Extract<FeedItem, { type: 'message' }>,
  next: Extract<FeedItem, { type: 'message' }>,
): Extract<FeedItem, { type: 'message' }> {
  const text = [prev.event.text ?? '', next.event.text ?? '']
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    ...next,
    key: prev.key,
    event: {
      ...next.event,
      text,
      ts: prev.event.ts,
    },
  };
}

// A compaction marker announces the turn's context snapshot. It folds into the
// Worked group with the rest of the activity — except when a run holds nothing
// else (a bare /compact), where it stays top-level: there is no work to fold it
// into, and a one-item "Worked for 0s" disclosure would hide the boundary.
function isCompactionMarker(it: FeedItem): boolean {
  return it.type === 'status' && isCompactionDivider(it.event);
}

// A fragment equal to the pinned spec is suppressed by FeedItemView only when
// its whole text matches the spec, so it must never be merged into prose (that
// would defeat the match and render the spec body twice) nor serve as the
// turn's answer (the pinned spec card already renders it).
function isSpecBody(text: string | undefined, specContent: string | undefined): boolean {
  const spec = specContent?.trim();
  return !!spec && (text ?? '').trim() === spec;
}

// The assistant's own written text: what a turn's answer, or a running turn's
// latest note, is made of.
function isAnswerCandidate(
  it: FeedItem,
  specContent: string | undefined,
): it is Extract<FeedItem, { type: 'message' }> {
  return (
    it.type === 'message' &&
    it.event.author !== 'user' &&
    !isSpokenLine(it) &&
    !isSpecBody(it.event.text, specContent)
  );
}

function lastAnswerCandidate(run: FeedItem[], specContent: string | undefined): number {
  for (let i = run.length - 1; i >= 0; i--) {
    if (isAnswerCandidate(run[i], specContent)) return i;
  }
  return -1;
}

// `running` is the part of the in-flight turn still being worked on; `steered`
// is a part of it the user has already steered past.
type TurnPhase = 'settled' | 'steered' | 'running';

// A compaction in progress at the running turn's tail is the feed's centered
// "Compacting…" cue, so it stays out of the fold.
function foldLiveRun(run: FeedItem[], specContent: string | undefined, phase: TurnPhase) {
  const tail = run.at(-1);
  if (phase === 'running' && tail?.type === 'status' && isCompactingStatus(tail.event.text)) {
    return [...collapseRun(run.slice(0, -1), specContent, phase), tail];
  }
  return collapseRun(run, specContent, phase);
}

interface TurnAnswer {
  message: Extract<FeedItem, { type: 'message' }>;
  // Where the merged answer shows: the run index of its first fragment.
  index: number;
  // Run indexes of every fragment and of the plan bookkeeping between them.
  absorbed: Set<number>;
}

// The turn's final answer: the run's last answer candidate, extended backwards
// across gaps holding only reasoning and todo/plan reconciliation — the model
// emitted its answer, checked off the plan, then finished the sentence, so
// those fragments are one response (#19). The reconciliation items are
// dropped; the reasoning folds. A live turn's latest note is not merged with
// earlier fragments because it may still be streaming.
function findTurnAnswer(
  run: FeedItem[],
  specContent: string | undefined,
  turnIsLive: boolean,
): TurnAnswer | undefined {
  const last = lastAnswerCandidate(run, specContent);
  if (last < 0) return undefined;
  const fragments = [last];
  const absorbed = new Set(fragments);
  let s = last;
  while (!turnIsLive && s > 0) {
    let j = s - 1;
    while (j >= 0 && (isReconciliationItem(run[j]) || run[j].type === 'thinking')) j--;
    // An empty gap merges too: a harness can re-invoke the model on an
    // injected system message the transcript never shows, so the nudge reply
    // lands immediately after the real answer. Without the merge, that
    // trailing bookkeeping reply becomes "the answer" and the real one
    // folds into Worked.
    if (j < 0 || !isAnswerCandidate(run[j], specContent)) break;
    for (let k = j; k < s; k++) {
      if (k === j || isReconciliationItem(run[k])) absorbed.add(k);
    }
    fragments.unshift(j);
    s = j;
  }
  const message = fragments
    .map((i) => run[i] as Extract<FeedItem, { type: 'message' }>)
    .reduce((merged, fragment) => mergeAssistantMessages(merged, fragment));
  return { message, index: s, absorbed };
}

// Items no fold may hide. The answer, browser pages and compaction markers are
// placed by collapseRun itself.
function staysTopLevel(it: FeedItem, turnIsLive: boolean): boolean {
  // A failed tool/result must stay visible after the turn completes instead of
  // being buried in a collapsed "Worked for …" group (classifier intent).
  if (it.type === 'error') return true;
  // Proposals are review surfaces, and a spawned thread is work that keeps
  // running after the turn: neither is hidden execution detail.
  if (it.type === 'tools') {
    return it.events.some(isAutomationProposalCall) || it.events.some(isThreadSpawnCall);
  }
  // The user heard this. Folding it into "Worked for …" would hide half of the
  // conversation they just had.
  if (isSpokenLine(it)) return true;
  // The image or design is what the turn produced, not a step along the way:
  // folding it would hide the thing that was asked for.
  if (it.type === 'generated_image' || it.type === 'canvas_artifact') return true;
  // A running turn's subagents can still be running behind a later note.
  if (it.type === 'child_session' || it.type === 'child_sessions') return turnIsLive;
  // The harness changed the model under the turn, often on a usage limit; the
  // answer after it ran on the new one.
  return isHarnessModelSwitch(it);
}

// Collapse an assistant turn: everything the turn did — thinking,
// tool/file activity, statuses, compaction dividers, child-session lines, and
// the assistant's mid-turn notes — folds into ONE "Worked for …" group between
// the prompt and the answer, so a settled turn reads prompt → Worked → final
// response and expanding the fold replays the whole turn (compaction divider
// included) at the configured density. The answer and the items in
// `staysTopLevel` remain outside it.
// Invariant (#18): the final answer itself is never nested inside a Worked
// group, no matter what trailing work or status follows it.
// A turn that has not settled folds the same way around its latest note. Its
// fold keeps the key it will have once the turn settles, so an opened fold
// stays open.
function collapseRun(
  run: FeedItem[],
  specContent?: string,
  phase: TurnPhase = 'settled',
): FeedItem[] {
  if (run.length === 0) return [];
  const turnIsLive = phase !== 'settled';
  const answer = findTurnAnswer(run, specContent, turnIsLive);

  // One fold per turn: every foldable item joins the same Worked group even
  // when work continues past the last assistant text, so a turn never shatters
  // into several folds. The group renders before the turn's top-level
  // survivors, with browser references following the final answer.
  // Foldables carry their run index so compaction markers land at their
  // transcript position inside the fold.
  const foldables: { index: number; item: FeedItem }[] = [];
  const survivors: FeedItem[] = [];
  const browserCards: FeedItem[] = [];
  const markers: { index: number; item: FeedItem }[] = [];
  for (let i = 0; i < run.length; i++) {
    const it = run[i];
    if (answer?.absorbed.has(i)) {
      if (i === answer.index) survivors.push(answer.message);
    } else if (staysTopLevel(it, turnIsLive)) {
      survivors.push(it);
    } else if (it.type === 'browser') {
      // The page the turn worked on stays in reach; its steps fold as usual.
      if (answer) browserCards.push(it);
      else survivors.push(it);
    } else if (isCompactionMarker(it)) {
      // Provisional: the marker moves into the fold when the run has real work.
      markers.push({ index: i, item: it });
      survivors.push(it);
    } else if (!(it.type === 'message' && isSpecBody(it.event.text, specContent))) {
      foldables.push({ index: i, item: it });
    }
  }
  if (answer) survivors.splice(survivors.indexOf(answer.message) + 1, 0, ...browserCards);
  // No work to fold: survivors already hold any markers in transcript order.
  if (foldables.length === 0) return survivors;
  // Markers moved into the fold; drop their provisional top-level copies.
  return [
    workedFold([...foldables, ...markers], phase),
    ...survivors.filter((it) => !isCompactionMarker(it)),
  ];
}

function workedFold(entries: { index: number; item: FeedItem }[], phase: TurnPhase): FeedItem {
  const items = entries.sort((a, b) => a.index - b.index).map((entry) => entry.item);
  const { start, end } = spanOf(items);
  return {
    type: 'worked',
    key: `worked-${items[0].key}`,
    items,
    durationMs: Math.max(0, end - start),
    ...(phase === 'running' ? { runningSince: start } : {}),
  };
}

// While the turn runs, everything after the user's last real prompt is live,
// including the work before a steer they sent into it. Settings rows open a
// visual turn, but they do not prove the prior generation stopped executing.
function turnStartIndex(items: FeedItem[], includeSettingsStatus: boolean): number {
  for (let k = items.length - 1; k >= 0; k -= 1) {
    const item = items[k];
    const boundary = item.type === 'message' || (includeSettingsStatus && item.type === 'status');
    if (
      boundary &&
      startsTurn(item.event) &&
      !(item.type === 'message' && isSteeredPrompt(item.event))
    ) {
      return k + 1;
    }
  }
  return 0;
}

export function liveTurnStart(items: FeedItem[]): number {
  return turnStartIndex(items, true);
}

export function liveExecutionTurnStart(items: FeedItem[]): number {
  return turnStartIndex(items, false);
}

// A completed turn that edited files gets a top-level "Changes · N files"
// summary so it survives the Worked-for folding.
function turnChangesSummary(run: FeedItem[]): FeedItem[] {
  const files = collectTurnFiles(run);
  if (files.length === 0) return [];
  return [
    {
      type: 'turnChanges',
      key: `changes-${run[0].key}`,
      tailEventId: feedItemTailId(run[run.length - 1]),
      files,
      added: files.reduce((s, f) => s + f.added, 0),
      removed: files.reduce((s, f) => s + f.removed, 0),
    },
  ];
}

// Fold completed assistant turns into "Worked for …" groups. The in-flight turn
// (while pending) is left expanded so live thinking/tools/status keep streaming,
// unless `foldLiveTurn` asks for one running fold above its latest note.
// `changes` adds each completed turn's changes summary.
export function groupTurns(
  items: FeedItem[],
  pending: boolean,
  specContent?: string,
  changes = false,
  foldLiveTurn = false,
): FeedItem[] {
  const out: FeedItem[] = [];
  const liveFrom = pending ? liveTurnStart(items) : items.length;
  let i = 0;
  while (i < items.length) {
    if (isTurnBoundary(items[i])) {
      out.push(items[i]);
      i++;
      continue;
    }
    const runStart = i;
    const run: FeedItem[] = [];
    while (i < items.length && !isTurnBoundary(items[i])) {
      run.push(items[i]);
      i++;
    }
    if (runStart < liveFrom) {
      out.push(...collapseRun(run, specContent));
      if (changes) out.push(...turnChangesSummary(run));
    } else if (foldLiveTurn) {
      out.push(...foldLiveRun(run, specContent, i === items.length ? 'running' : 'steered'));
    } else {
      out.push(...run);
    }
  }
  return out;
}
