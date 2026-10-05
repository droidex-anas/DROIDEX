import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp } from '@droidex/icons';
import { useStoreSelector } from '../../hooks/useStore';
import { useSessionLive } from '../../hooks/useSessionLive';
import { browserStepLabel } from '../../lib/browserTools';
import { transcriptEventIsVisible } from '../../lib/childSessions';
import { wrapTabFocus } from '../../lib/focusTrap';
import { sessionAttention } from '../../lib/sessionAttention';
import type { SessionActivityStatus } from '../../lib/sidebarActivity';
import { formatDuration } from '../../lib/tools';
import type { SessionSummary, TranscriptEvent } from '../../types/bridge';
import { ActivityStatusGlyph } from '../ActivityStatusGlyph';
import { FeedItemView } from '../chat';
import { buildFeed, startsTurn, type FeedItem } from '../chatFeed';
import { PendingSteers } from '../transcript/PendingSteers';
import { WorkingIndicator } from '../transcript/primitives';
import { summarizeTools } from '../transcript/rows';

const NO_EVENTS: TranscriptEvent[] = [];
// The panel draws the turn's latest steps and leaves the rest to the chat,
// with no more tool calls and results than it should mount at once. Closed,
// only enough of the turn's tail is read to name the step in flight.
const PANEL_ROWS = 40;
const PANEL_TOOL_EVENTS = 120;
const CUE_EVENTS = 100;

// One line over the full-screen page saying what the agent is doing now, the
// way the transcript's live tail says it. It opens into the current turn's
// latest steps, drawn by the transcript's own rows, with any steers still
// waiting. Idle, it reads "Worked for 12s" quietly, as the finished turn does
// in the transcript; before the chat's first turn there is nothing to show.
// The steps open over the whole row it sits in, which places them.
export function BrowserActivityLine({ appSessionId }: { appSessionId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const atBottomRef = useRef(true);
  const live = useSessionLive(appSessionId);
  const transcript = useStoreSelector((state) => state.transcripts[appSessionId] ?? NO_EVENTS);
  const turn = useMemo(() => currentTurn(transcript), [transcript]);
  const steerCount = useStoreSelector(
    (state) => sessionOf(state.sessions, appSessionId)?.pendingSteers?.length ?? 0,
  );
  const status = useStoreSelector((state): SessionActivityStatus => {
    const attention = sessionAttention(
      appSessionId,
      state.pendingPermissions,
      state.pendingQuestions,
    );
    if (attention) return attention === 'approval' ? 'approval' : 'input';
    if (live) return 'working';
    const session = sessionOf(state.sessions, appSessionId);
    if (session?.phase === 'failed') return 'failed';
    if (session?.interruptReason) return 'interrupted';
    return 'ready';
  });
  // Opened, the whole turn is grouped, so a group keeps its key, and with it
  // its opened details, as new steps arrive.
  const feed = useMemo(
    () =>
      buildFeed(open ? turn.events : recentEvents(turn.events, CUE_EVENTS))
        // The page shows the browser's work itself, so its card stays in the transcript.
        .filter((item) => item.type !== 'browser'),
    [turn.events, open],
  );
  const { steps, trimmed } = useMemo(() => latestSteps(feed), [feed]);
  const earlier = (!turn.start && turn.events.length > 0) || trimmed;

  useEffect(() => {
    if (!open) return;
    // Opened from the keyboard or not, the steps take focus so Tab walks them.
    stepsRef.current?.focus();
    const close = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (rootRef.current?.contains(document.activeElement)) wrapTabFocus(event, rootRef.current);
    };
    // A click on the page lands in its own document; here it only shows as
    // the focus leaving for the page. A dialog a step opened, such as a
    // screenshot shown large, is still part of the panel.
    const onAway = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      const dialog = target instanceof Element ? target.closest('[role="dialog"]') : null;
      if (dialog && !dialog.contains(rootRef.current)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onAway);
    window.addEventListener('focusin', onAway);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onAway);
      window.removeEventListener('focusin', onAway);
    };
  }, [open]);

  // Opened, the newest step is in view, and stays there as steps arrive
  // unless the reader has scrolled up to an earlier one.
  useLayoutEffect(() => {
    const list = stepsRef.current;
    if (open && list && atBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [open, steps, steerCount]);

  if (!turn.start && turn.events.length === 0 && steerCount === 0) return null;
  const tail = feed.at(-1);
  const startTs = turn.start?.ts ?? turn.events.at(0)?.ts ?? 0;
  const cue = liveCue(tail, startTs);
  const worked = workedFor(turn.events, startTs);
  // A thinking or status row already shows itself working, as in the transcript.
  const tailWorks = tail?.type === 'thinking' || tail?.type === 'status';

  return (
    <div ref={rootRef} className="min-w-0">
      <AnimatePresence>
        {open && (
          <motion.div
            ref={stepsRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onScroll={(event) => {
              const list = event.currentTarget;
              atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
            }}
            // The room above the composer, which a tall draft shrinks.
            style={{ maxHeight: 'min(420px, calc(var(--page-room, 420px) - 16px))' }}
            className="absolute inset-x-0 bottom-full mb-2 overflow-y-auto rounded-2xl border border-droid-border/60 bg-droid-raised p-4 shadow-droid outline-none"
          >
            {earlier && (
              <p className="mb-2.5 text-[12px] text-droid-text-muted">
                Earlier steps are in the chat
              </p>
            )}
            <div className="space-y-2.5">
              {steps.map((item, index) => (
                <FeedItemView
                  key={item.key}
                  item={item}
                  live={live && index === steps.length - 1}
                  sessionLive={live}
                  liveTiming
                  density="compact"
                />
              ))}
              {live && !tailWorks && <WorkingIndicator {...cue} />}
            </div>
            <PendingSteers appSessionId={appSessionId} />
          </motion.div>
        )}
      </AnimatePresence>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => {
          atBottomRef.current = true;
          setOpen((value) => !value);
        }}
        className="group flex h-8 max-w-full items-center gap-2 rounded-md border border-droid-border bg-droid-bg/90 pl-2.5 pr-2 shadow-droid-sm backdrop-blur transition-colors hover:border-droid-border-hover"
      >
        <ActivityStatusGlyph status={status} decorative />
        <span className="min-w-0 truncate">
          {live ? (
            <WorkingIndicator {...cue} />
          ) : (
            <span className="text-[13px] text-droid-text-muted transition-colors group-hover:text-droid-text-secondary">
              {worked >= 1000 ? `Worked for ${formatDuration(worked)}` : 'Worked'}
            </span>
          )}
        </span>
        {steerCount > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-droid-text-muted">
            {steerCount} waiting
          </span>
        )}
        <ChevronUp
          className={`h-3 w-3 shrink-0 text-droid-text-muted/50 transition-transform duration-200 group-hover:text-droid-text-muted ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
}

function sessionOf(
  sessions: Record<string, SessionSummary>,
  appSessionId: string,
): SessionSummary | undefined {
  return Object.hasOwn(sessions, appSessionId) ? sessions[appSessionId] : undefined;
}

interface Turn {
  // The prompt or settings change that opened the turn, unless the loaded
  // part of the chat no longer reaches back to it.
  start?: TranscriptEvent;
  events: TranscriptEvent[];
}

// The chat's latest turn as the transcript groups it (the primary transcript,
// not a subagent's), except that a steer the model took in is a step of the
// run it joined. When the turn began before the loaded part of the chat, what
// is loaded stands for it.
function currentTurn(transcript: TranscriptEvent[]): Turn {
  const since: TranscriptEvent[] = [];
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index];
    if (!transcriptEventIsVisible(event, null)) continue;
    if (startsTurn(event) && !event.steered) return { start: event, events: since.reverse() };
    since.push(event);
  }
  return { events: since.reverse() };
}

// The feed's last rows. A long run of tool calls keeps only its newest, so the
// panel mounts a bounded number of them however long the turn has run.
function latestSteps(feed: FeedItem[]): { steps: FeedItem[]; trimmed: boolean } {
  const steps: FeedItem[] = [];
  let room = PANEL_TOOL_EVENTS;
  let index = feed.length - 1;
  for (; index >= 0 && steps.length < PANEL_ROWS && room > 0; index -= 1) {
    const item = feed[index];
    if (item.type !== 'tools') {
      steps.push(item);
      continue;
    }
    const events = recentEvents(item.events, room);
    room -= item.events.length;
    if (events.length > 0) steps.push(events === item.events ? item : { ...item, events });
  }
  return { steps: steps.reverse(), trimmed: index >= 0 || room < 0 };
}

// The turn's last events, starting clear of a result whose call was cut off,
// which would otherwise draw as a bare result.
// The newest events, without a result whose call was cut off with the older
// ones, so no step shows detached from its call.
function recentEvents(events: TranscriptEvent[], limit: number): TranscriptEvent[] {
  if (events.length <= limit) return events;
  const kept = events.slice(events.length - limit);
  const calls = new Set(kept.filter((event) => event.kind === 'tool_call').map((e) => e.toolUseId));
  return kept.filter(
    (event) => event.kind !== 'tool_result' || !event.toolUseId || calls.has(event.toolUseId),
  );
}

function workedFor(events: TranscriptEvent[], startTs: number): number {
  const last = events.at(-1);
  if (!last) return 0;
  return Math.max(0, (last.endTs ?? last.ts) - startTs);
}

// The words and the clock for the step in flight, in the transcript's voice.
function liveCue(tail: FeedItem | undefined, turnTs: number): { label: string; startTs: number } {
  switch (tail?.type) {
    case 'thinking':
      return { label: 'Thinking', startTs: tail.event.ts };
    case 'tools':
      return {
        label: browserStepLabel(tail.events) ?? summarizeTools(tail.events, true),
        startTs: tail.events[0]?.ts ?? turnTs,
      };
    case 'diff':
    case 'diffs':
      return { label: 'Updating files', startTs: turnTs };
    case 'status':
      return { label: tail.event.text ?? 'Working', startTs: tail.event.ts };
    default:
      return { label: 'Working', startTs: turnTs };
  }
}
