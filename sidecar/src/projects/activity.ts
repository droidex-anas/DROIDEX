import type { TranscriptEvent } from '../protocol.js';
import { LEDGER_LIMITS } from './store.js';

/** The kinds a model produces while answering; the rest are the app talking. */
const GENERATED = new Set<TranscriptEvent['kind']>([
  'text',
  'thinking',
  'tool_call',
  'tool_result',
  'error',
]);

/** What a thread's turn came back with: its final reply, and why it stopped. */
export interface ThreadTurn {
  text: string;
  error?: string;
}

/**
 * The current turn of each project conversation. Only the final primary reply
 * is retained; thinking and tool output never enter it.
 *
 * A turn opens on the first sign of one, the streaming flag or the first event
 * the model generates, because a summary update and a transcript event can
 * reach here in either order, and a reply that opened no turn would be
 * reported as silence.
 */
export class ProjectActivity {
  private readonly turns = new Map<string, ThreadTurn>();

  open(appSessionId: string): boolean {
    if (this.turns.has(appSessionId)) return false;
    this.turns.set(appSessionId, { text: '' });
    return true;
  }

  /** Callers pass events of project conversations only. */
  append(event: TranscriptEvent): void {
    if (event.role !== 'primary' || event.author === 'user') return;
    // Only generation opens a turn. A status line or a compaction divider
    // reaches an idle thread (retuning one, or an automatic compaction), and
    // opening a turn on it would report silence its owner never asked for.
    if (!GENERATED.has(event.kind)) return;
    this.open(event.appSessionId);
    const turn = this.turns.get(event.appSessionId);
    if (turn) applyGenerated(turn, event);
  }

  /** The settled turn, or nothing when this conversation had none open. */
  finish(appSessionId: string): ThreadTurn | undefined {
    const turn = this.turns.get(appSessionId);
    this.turns.delete(appSessionId);
    return turn;
  }

  clear(): void {
    this.turns.clear();
  }
}

/** How a stored conversation ends: its last turn's final reply, and whether
    the newest message in it is that reply or a prompt. */
export interface TranscriptEnding {
  reply: string;
  last?: 'reply' | 'prompt';
}

export function transcriptEnding(events: readonly TranscriptEvent[]): TranscriptEnding {
  let turn: ThreadTurn = { text: '' };
  let last: TranscriptEnding['last'];
  for (const event of events) {
    if (event.role !== 'primary') continue;
    if (event.author === 'user') {
      turn = { text: '' };
      last = 'prompt';
    } else if (GENERATED.has(event.kind)) {
      applyGenerated(turn, event);
      if (event.kind === 'text') last = 'reply';
    }
  }
  return { reply: turn.text, ...(last ? { last } : {}) };
}

/* One generated event applied to the turn it belongs to. A live thread's turn
   and the end of a stored transcript both go through here, so a final reply
   means the same thing in both: the text after the turn's last tool call. */
function applyGenerated(turn: ThreadTurn, event: TranscriptEvent): void {
  if (event.kind === 'tool_call') {
    // A pre-tool explanation is not the final report.
    turn.text = '';
  } else if (event.kind === 'text') {
    turn.text = (turn.text + (event.text ?? '')).slice(-LEDGER_LIMITS.text);
  } else if (event.kind === 'error') {
    turn.error = (event.text ?? '').slice(0, LEDGER_LIMITS.threadError);
  }
}
