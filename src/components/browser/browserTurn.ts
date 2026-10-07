import { browserToolOf } from '../../lib/browserTools';
import { transcriptEventIsVisible } from '../../lib/childSessions';
import { sessionIsLive } from '../../lib/sessions';
import type { SessionSummary, TranscriptEvent } from '../../types/bridge';

export interface Turn {
  // The prompt that opened the turn, unless the loaded part of the chat no
  // longer reaches back to it. A model change mid-run stays inside the turn.
  start?: TranscriptEvent;
  events: TranscriptEvent[];
}

// A transcript is replaced, never changed, so its turn is worked out once
// however many places ask.
const turns = new WeakMap<TranscriptEvent[], Turn>();

// The chat's latest turn as the transcript groups it (the primary transcript,
// not a subagent's), except that a steer the model took in is a step of the
// run it joined. When the turn began before the loaded part of the chat, what
// is loaded stands for it.
export function currentTurn(transcript: TranscriptEvent[]): Turn {
  const known = turns.get(transcript);
  if (known) return known;
  const since: TranscriptEvent[] = [];
  let start: TranscriptEvent | undefined;
  for (let index = transcript.length - 1; index >= 0 && !start; index -= 1) {
    const event = transcript[index];
    if (!transcriptEventIsVisible(event, null)) continue;
    if (event.author === 'user' && !event.steered) start = event;
    else since.push(event);
  }
  const turn = { start, events: since.reverse() };
  turns.set(transcript, turn);
  return turn;
}

/**
 * An agent is at work in the chat's browser: its turn is running and has
 * called a browser tool. The user's own browsing makes no call, and each turn
 * counts only its own.
 */
export function browserAtWork(
  session: SessionSummary | undefined,
  transcript: TranscriptEvent[] | undefined,
): boolean {
  if (!session || !transcript || !sessionIsLive(session)) return false;
  const turn = currentTurn(transcript);
  let used = usesBrowser.get(turn);
  if (used === undefined) {
    used = turn.events.some(
      (event) => event.kind === 'tool_call' && browserToolOf(event.toolName) !== null,
    );
    usesBrowser.set(turn, used);
  }
  return used;
}

const usesBrowser = new WeakMap<Turn, boolean>();
