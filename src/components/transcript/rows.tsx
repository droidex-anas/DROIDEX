import { useState } from 'react';
import { Check } from 'lucide-react';
import type { TranscriptEvent } from '../../types/bridge';
import {
  toolMeta,
  safeJson,
  stripAnsi,
  formatDuration,
  parseTodos,
  isListingTool,
  isWebSearchTool,
  isWebFetchTool,
  toolArgString,
  type TodoStatus,
} from '../../lib/tools';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';
import { classifyEvent } from '../../lib/transcript';
import { compactPath } from '../../lib/pathDisplay';
import { StreamingCaret } from '../StreamingCaret';
import { Caret, ErrorTag, Expand, firstLine, linkify, useElapsed } from './primitives';
import { CommandCard, CommandLine } from './commandCard';
import { TranscriptImage } from '../media/TranscriptImage';
import { ToolLine } from './toolLine';
import { ToolFilesCard, type ExplorationCall } from './toolFilesCard';
import { SkillCard } from './skillCard';
import { WebFetchCard, WebSearchCard } from './webCards';

/* ── Thinking / Thought ── */
export function ThinkingItem({
  text,
  durationMs,
  active,
  startTs,
}: {
  text: string;
  durationMs?: number;
  active?: boolean;
  startTs?: number;
}) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(startTs, !!active);
  const label = active
    ? elapsed >= 1000
      ? `Thinking ${formatDuration(elapsed)}`
      : 'Thinking'
    : durationMs != null && durationMs >= 1000
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Thought';
  return (
    <div>
      <button
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="group flex items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        {active ? (
          <span className="shimmer-text text-body-strong">{label}</span>
        ) : (
          <span className="text-body text-muted group-hover:text-secondary transition-colors">
            {label}
          </span>
        )}
        <Caret open={open} />
      </button>
      <Expand open={open}>
        <div className="mt-2 pl-5 text-body text-quiet whitespace-pre-wrap break-words">
          {text}
          {active && <StreamingCaret />}
        </div>
      </Expand>
    </div>
  );
}

/* ── Activity summaries ── */

interface ActivityCounts {
  editedPaths: Set<string>;
  // The one file read when exactly one was, so the fold can name it.
  readFile?: string;
  file: number;
  search: number;
  command: number;
  page: number;
  task: number;
  step: number;
  plan: number;
  onlyExec: boolean;
  onlyWeb: boolean;
  onlyPlan: boolean;
  sawCall: boolean;
}

function emptyCounts(): ActivityCounts {
  return {
    editedPaths: new Set(),
    file: 0,
    search: 0,
    command: 0,
    page: 0,
    task: 0,
    step: 0,
    plan: 0,
    onlyExec: true,
    onlyWeb: true,
    onlyPlan: true,
    sawCall: false,
  };
}

function countToolCall(counts: ActivityCounts, e: TranscriptEvent): void {
  counts.sawCall = true;
  // A TodoWrite is internal plan bookkeeping, not a file/command, so it must
  // not inflate the "Explored N files" summary (#20).
  if (classifyEvent(e) === 'plan_update') {
    counts.plan++;
    counts.onlyExec = false;
    counts.onlyWeb = false;
    return;
  }
  counts.onlyPlan = false;
  const { cat, detail } = toolMeta(e.toolName, e.toolArgs);
  if (cat !== 'exec') counts.onlyExec = false;
  if (cat !== 'web') counts.onlyWeb = false;
  if (cat === 'read') {
    counts.file++;
    // A lone read is named only when it read a file; a directory listing
    // (LS, list_directory) is still "1 file", never "Explored src".
    if (!isListingTool(e.toolName) && !detail.endsWith('/')) counts.readFile = detail;
  } else if (cat === 'search') counts.search++;
  else if (cat === 'exec') counts.command++;
  else if (cat === 'web') counts.page++;
  else if (cat === 'task') counts.task++;
  else if (cat === 'skill') counts.step++;
  else counts.step++;
}

function formatCounts(counts: ActivityCounts, live: boolean): string {
  const parts: string[] = [];
  const add = (n: number, s: string, p: string) => {
    if (n > 0) parts.push(`${String(n)} ${n === 1 ? s : p}`);
  };
  if (counts.file === 1 && counts.readFile) parts.push(compactPath(counts.readFile));
  else add(counts.file, 'file', 'files');
  add(counts.search, 'search', 'searches');
  add(counts.command, 'command', 'commands');
  add(counts.page, 'page', 'pages');
  add(counts.task, 'task', 'tasks');
  add(counts.step, 'step', 'steps');
  add(counts.plan, 'plan update', 'plan updates');
  const verb = counts.onlyExec
    ? live
      ? 'Running'
      : 'Ran'
    : counts.onlyWeb
      ? live
        ? 'Fetching'
        : 'Fetched'
      : live
        ? 'Exploring'
        : 'Explored';
  return `${verb} ${parts.join(', ')}`;
}

/* ── Condensed tool group: "Explored 4 files, 1 search" ── */
// True while a call in the group still awaits its result during a live
// session: the group's work is genuinely in flight, whether or not it is the
// feed's tail.
export function hasPendingCall(events: TranscriptEvent[], sessionLive: boolean): boolean {
  if (!sessionLive) return false;
  const { resultByCall } = correlateResults(events);
  // A plan update's result is consumed by its checklist rather than mapped to
  // the call, so it is looked up by id; one without an id cannot be paired
  // and counts as settled rather than pending forever.
  const resultIds = new Set(
    events.flatMap((e) => (e.kind === 'tool_result' && e.toolUseId ? [e.toolUseId] : [])),
  );
  return events.some((e) => {
    if (e.kind !== 'tool_call') return false;
    if (classifyEvent(e) === 'plan_update')
      return Boolean(e.toolUseId) && !resultIds.has(e.toolUseId ?? '');
    return !resultByCall.has(e);
  });
}

// `live` while the group's work is in flight: the summary then speaks in the
// same progressive voice as the rows it folds ("Running 2 commands").
export function summarizeTools(events: TranscriptEvent[], live = false): string {
  const counts = emptyCounts();
  for (const e of events) {
    if (e.kind === 'tool_call') countToolCall(counts, e);
  }
  if (!counts.sawCall) return 'Tool result';
  if (counts.onlyPlan) return live ? 'Updating plan' : 'Updated plan';
  return formatCounts(counts, live);
}

// A standalone failed result (or a pure error event) rendered as a collapsible
// row: a red "error" tag with the first line, expanding to the full message.
// An error reads like the other turn rows ("Worked for 12s"): a disclosure
// whose label names the error, with the tag at the row's right edge.
export function ErrorLine({ text, attempts }: { text: string; attempts?: number }) {
  const [open, setOpen] = useState(false);
  const body = stripAnsi(text).trim();
  const head = firstLine(body);
  const label = /^error\b/i.test(head) ? head : `Error: ${head}`;
  return (
    <div>
      <button
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="group flex w-full min-w-0 items-center gap-1.5 text-left text-body"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate text-secondary">{label}</span>
        {attempts ? <span className="shrink-0 text-muted">· {attempts} attempts</span> : null}
        <Caret open={open} />
        <ErrorTag emphasis />
      </button>
      <Expand open={open}>
        <div className="mt-1.5 pl-5">
          <pre className="max-h-56 overflow-auto rounded-sm px-2.5 py-2 font-mono text-code whitespace-pre-wrap break-words bg-danger-soft text-danger">
            {linkify(body)}
          </pre>
        </div>
      </Expand>
    </div>
  );
}

// Same ring language as the composer's plan strip: filled when done, a ring
// otherwise, with the running step's ring in the text colour.
function TodoMark({ status }: { status: TodoStatus }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-muted">
        <Check className="size-2.5 text-bg" strokeWidth={3} />
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`mt-0.5 size-icon-sm shrink-0 ${
        status === 'in_progress' ? 'text-primary' : 'text-muted/40'
      }`}
    >
      <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TodoChecklist({ event }: { event: TranscriptEvent }) {
  const todos = parseTodos(event.toolArgs);
  if (todos.length === 0) return <div className="text-body text-secondary">Updated plan</div>;
  return (
    <div className="space-y-1">
      {todos.map((t, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 text-body break-words ${
            t.status === 'completed' ? 'text-muted line-through' : 'text-secondary'
          }`}
        >
          <TodoMark status={t.status} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// Pair each tool_call with its tool_result across the whole group. Results
// correlate by toolUseId wherever they sit (replayed transcripts batch several
// calls before their results, so the result is often not adjacent); id-less
// live results fall back to the call they immediately follow. Returns the
// inline output for non-plan calls plus the set of results already accounted
// for, so the renderer never shows a correlated result a second time as raw
// activity. A plan_update's own *successful* result is consumed silently (the
// checklist conveys it); a failed one is left to surface.
export function correlateResults(events: TranscriptEvent[]): {
  resultByCall: Map<TranscriptEvent, TranscriptEvent>;
  consumed: Set<TranscriptEvent>;
} {
  const resultByCall = new Map<TranscriptEvent, TranscriptEvent>();
  const consumed = new Set<TranscriptEvent>();
  const resultById = new Map<string, TranscriptEvent>();
  for (const e of events)
    if (e.kind === 'tool_result' && e.toolUseId) resultById.set(e.toolUseId, e);
  let unmatchedIdlessCalls = 0;
  for (let i = 0; i < events.length; i++) {
    const call = events[i];
    if (call.kind === 'tool_result' && !call.toolUseId) {
      unmatchedIdlessCalls = Math.max(0, unmatchedIdlessCalls - 1);
    }
    if (call.kind !== 'tool_call') continue;
    let result: TranscriptEvent | undefined;
    if (call.toolUseId) {
      result = resultById.get(call.toolUseId);
    } else {
      unmatchedIdlessCalls++;
      const next = events.at(i + 1);
      // Multiple outstanding calls cannot be correlated safely without IDs.
      if (unmatchedIdlessCalls === 1 && next?.kind === 'tool_result' && !next.toolUseId) {
        result = next;
      }
    }
    if (!result || consumed.has(result)) continue;
    // A failed plan result must surface (the checklist cannot convey a failure),
    // so it is left unconsumed. Every other result — success or failure —
    // attaches to its call so a failure folds into the tool card as an "error".
    if (result.isError && classifyEvent(call) === 'plan_update') continue;
    if (classifyEvent(call) !== 'plan_update') resultByCall.set(call, result);
    consumed.add(result);
  }
  return { resultByCall, consumed };
}

// The maximal run of consecutive read/search calls starting at `start`, in
// which every member renders as file chips. Correlated results interleave with
// the calls (a replayed transcript batches several calls before their
// results), so consumed results are stepped over; anything else — another
// tool, a plan update, an unconsumed result — ends the run.
function gatherExplorationRun(
  events: TranscriptEvent[],
  start: number,
  resultByCall: Map<TranscriptEvent, TranscriptEvent>,
  consumed: Set<TranscriptEvent>,
): { run: ExplorationCall[]; end: number } {
  const run: ExplorationCall[] = [
    { event: events[start], result: resultByCall.get(events[start]) },
  ];
  let end = start + 1;
  while (end < events.length) {
    const next = events[end];
    if (next.kind === 'tool_result' && consumed.has(next)) {
      end++;
      continue;
    }
    if (next.kind !== 'tool_call' || classifyEvent(next) === 'plan_update') break;
    const { cat } = toolMeta(next.toolName, next.toolArgs);
    if (cat !== 'read' && cat !== 'search') break;
    run.push({ event: next, result: resultByCall.get(next) });
    end++;
  }
  return { run, end };
}

// Render one tool group's calls as readable rows. `detailed` shows bodies
// inline (the detailed density); otherwise rows are lines that expand to their
// bodies on click. Reads and searches are the exception: they render
// visual-only rows (file chips, no raw body), and a consecutive burst of them
// merges into a single row.
export function renderToolEvents(
  events: TranscriptEvent[],
  live = false,
  detailed = false,
  onOpenReviewFile?: OpenReviewFileHandler,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const { resultByCall, consumed } = correlateResults(events);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === 'tool_call') {
      if (classifyEvent(e) === 'plan_update') {
        nodes.push(<TodoChecklist key={e.id} event={e} />);
        continue;
      }
      const result = resultByCall.get(e);
      // The provider says when a call never ran because the user steered or
      // stopped the turn. That is not a failure, and must not read as one.
      const interrupted = result?.interrupted === true;
      const isError = !!result?.isError;
      // A call without its result while the group is live is still in flight —
      // web/fetch cards show a shimmer until the result lands.
      const running = live && !result;
      const { cat, detail } = toolMeta(e.toolName, e.toolArgs);
      // WebSearch's name matches the generic /search/ category, so route it by
      // name (not cat) to the readable result-card renderer.
      if (isWebSearchTool(e.toolName)) {
        nodes.push(
          <WebSearchCard
            key={e.id}
            event={e}
            output={result?.text}
            images={result?.images}
            error={isError}
            interrupted={interrupted}
            running={running}
            forceOpen={detailed}
          />,
        );
      } else if (isWebFetchTool(e.toolName) || cat === 'web') {
        // FetchUrl / page fetches get the same source-card treatment as search.
        nodes.push(
          <WebFetchCard
            key={e.id}
            event={e}
            output={result?.text}
            images={result?.images}
            error={isError}
            interrupted={interrupted}
            running={running}
            forceOpen={detailed}
          />,
        );
      } else if (cat === 'skill') {
        // A skill invocation reads as the skill, not as its raw payload.
        nodes.push(
          <SkillCard
            key={e.id}
            event={e}
            output={result?.text}
            images={result?.images}
            error={isError}
            interrupted={interrupted}
            running={running}
            forceOpen={detailed}
          />,
        );
      } else if (cat === 'exec') {
        const command =
          toolArgString(e.toolArgs, 'command') ??
          toolArgString(e.toolArgs, 'cmd') ??
          toolArgString(e.toolArgs, 'script') ??
          detail;
        // Detailed density shows the terminal body inline; other densities keep
        // a one-line row that expands to it (a live call shimmers until done).
        nodes.push(
          detailed ? (
            <CommandCard
              key={e.id}
              command={command}
              output={result?.text}
              images={result?.images}
              error={isError}
              interrupted={interrupted}
              running={running}
            />
          ) : (
            <CommandLine
              key={e.id}
              command={command}
              output={result?.text}
              images={result?.images}
              error={isError}
              interrupted={interrupted}
              running={running}
              forceOpen={false}
            />
          ),
        );
      } else if (cat === 'search' || cat === 'read') {
        // A burst of consecutive reads/searches is one exploration gesture and
        // renders as a single row with every file pooled into one chip rail.
        // Keyed by the run's first call, so a live row growing into a burst
        // keeps its chips instead of remounting.
        const { run, end } = gatherExplorationRun(events, i, resultByCall, consumed);
        nodes.push(
          <ToolFilesCard key={e.id} calls={run} live={live} onOpenReviewFile={onOpenReviewFile} />,
        );
        // The run's results are consumed, so the tail skip renders nothing for
        // them; landing the loop past them keeps the walk linear.
        i = end - 1;
      } else {
        nodes.push(
          <ToolLine
            key={e.id}
            event={e}
            output={result?.text}
            images={result?.images}
            error={isError}
            interrupted={interrupted}
            running={running}
            forceOpen={detailed}
            onOpenReviewFile={onOpenReviewFile}
          />,
        );
      }
      continue;
    }
    // A result already shown as its call's inline output (or a silently consumed
    // plan result) must not also render as raw activity.
    if (e.kind === 'tool_result' && consumed.has(e)) continue;
    // A result whose call is out of view still shows the pictures it carried.
    for (const [index, image] of (e.images ?? []).entries())
      nodes.push(<TranscriptImage key={`${e.id}-${String(index)}-${image}`} reference={image} />);
    const body = stripAnsi(e.text ?? safeJson(e.toolArgs)).trimEnd();
    if (!body) continue;
    // A failed result with no call to fold into (e.g. a failed edit that broke
    // its diff run) renders as a compact, expandable error rather than a dump.
    if (e.kind === 'tool_result' && e.isError) {
      nodes.push(<ErrorLine key={e.id} text={body} />);
      continue;
    }
    nodes.push(
      <pre
        key={e.id}
        className="max-h-48 overflow-auto rounded-sm bg-bg/50 px-2.5 py-2 font-mono text-code text-muted/80 whitespace-pre-wrap break-words"
      >
        {linkify(body)}
      </pre>,
    );
  }
  return nodes;
}
