import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp } from '@droidex/icons';
import { useStoreSelector } from '../../hooks/useStore';
import { useSessionLive } from '../../hooks/useSessionLive';
import { browserStepLabel } from '../../lib/browserTools';
import { transcriptEventIsVisible } from '../../lib/childSessions';
import { sessionAttention } from '../../lib/sessionAttention';
import type { SessionActivityStatus } from '../../lib/sidebarActivity';
import { formatDuration } from '../../lib/tools';
import type { SessionSummary, TranscriptEvent } from '../../types/bridge';
import { ActivityStatusGlyph } from '../ActivityStatusGlyph';
import { FeedItemView } from '../chat';
import { buildFeed, type FeedItem } from '../chatFeed';
import { PendingSteers } from '../transcript/PendingSteers';
import { WorkingIndicator } from '../transcript/primitives';
import { summarizeTools } from '../transcript/rows';

const NO_EVENTS: TranscriptEvent[] = [];

// One line over the full-screen page saying what the agent is doing now, the
// way the transcript's live tail says it. It opens into the current turn's
// steps, drawn by the transcript's own rows, with any steers still waiting.
// Idle, it reads "Worked for 12s" quietly, as the finished turn does in the
// transcript; before the chat's first turn there is nothing to show. The steps
// open over the whole row it sits in, which places them.
export function BrowserActivityLine({ appSessionId }: { appSessionId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const live = useSessionLive(appSessionId);
  const turn = useStoreSelector(
    (state) => currentTurn(state.transcripts[appSessionId] ?? NO_EVENTS),
    sameTurn,
  );
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
  // The page shows the browser's work itself, so its card stays in the transcript.
  const steps = useMemo(
    () => buildFeed(turn.events).filter((item) => item.type !== 'browser'),
    [turn.events],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // A click on the page lands in its own document; here it only shows as
    // the focus leaving for the page.
    const onAway = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
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

  // Opened, the newest step is in view, and stays there as steps arrive.
  useLayoutEffect(() => {
    const list = stepsRef.current;
    if (open && list) list.scrollTop = list.scrollHeight;
  }, [open, turn.events, steerCount]);

  if (!turn.prompt) return null;
  const tail = steps.at(-1);
  const cue = liveCue(tail, turn.prompt);
  const worked = workedFor(turn);
  // A thinking or status row already shows itself working, as in the transcript.
  const tailWorks = tail?.type === 'thinking' || tail?.type === 'status';

  return (
    <div ref={rootRef} className="min-w-0">
      <AnimatePresence>
        {open && (
          <motion.div
            ref={stepsRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 bottom-full mb-2 max-h-[min(50vh,420px)] overflow-y-auto rounded-2xl border border-droid-border/60 bg-droid-raised p-4 shadow-droid"
          >
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
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="group flex h-8 max-w-full items-center gap-2 rounded-md border border-droid-border bg-droid-bg/90 pl-2.5 pr-2 shadow-lg backdrop-blur transition-colors hover:border-droid-border-hover"
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
  prompt?: TranscriptEvent;
  events: TranscriptEvent[];
}

// The chat's latest prompt and what the agent has done since, as the chat
// shows it (the primary transcript, not a subagent's). A steer the model took
// in is a step of the turn it joined, not a turn of its own.
function currentTurn(transcript: TranscriptEvent[]): Turn {
  const since: TranscriptEvent[] = [];
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index];
    if (!transcriptEventIsVisible(event, null)) continue;
    if (event.author === 'user' && !event.steered)
      return { prompt: event, events: since.reverse() };
    since.push(event);
  }
  return { events: since.reverse() };
}

function sameTurn(left: Turn, right: Turn): boolean {
  return (
    left.prompt === right.prompt &&
    left.events.length === right.events.length &&
    left.events.every((event, index) => event === right.events[index])
  );
}

function workedFor({ prompt, events }: Turn): number {
  const last = events.at(-1);
  if (!prompt || !last) return 0;
  return Math.max(0, (last.endTs ?? last.ts) - prompt.ts);
}

// The words and the clock for the step in flight, in the transcript's voice.
function liveCue(
  tail: FeedItem | undefined,
  prompt: TranscriptEvent,
): { label: string; startTs: number } {
  switch (tail?.type) {
    case 'thinking':
      return { label: 'Thinking', startTs: tail.event.ts };
    case 'tools':
      return {
        label: browserStepLabel(tail.events) ?? summarizeTools(tail.events, true),
        startTs: tail.events[0]?.ts ?? prompt.ts,
      };
    case 'diff':
    case 'diffs':
      return { label: 'Updating files', startTs: prompt.ts };
    case 'status':
      return { label: tail.event.text ?? 'Working', startTs: tail.event.ts };
    default:
      return { label: 'Working', startTs: prompt.ts };
  }
}
