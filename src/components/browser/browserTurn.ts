import { transcriptEventIsVisible } from '../../lib/childSessions';
import type { TranscriptEvent } from '../../types/bridge';
import { startsTurn } from '../chatFeed';

export interface Turn {
  // The prompt or settings change that opened the turn, unless the loaded
  // part of the chat no longer reaches back to it.
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
    if (startsTurn(event) && !event.steered) start = event;
    else since.push(event);
  }
  const turn = { start, events: since.reverse() };
  turns.set(transcript, turn);
  return turn;
}
