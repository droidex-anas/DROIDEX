import type { TranscriptEvent } from '../protocol.js';

/** What a thread's turn came back with: its final reply, and why it stopped. */
export interface ThreadTurn {
  text: string;
  error?: string;
}

/**
 * The current turn of each project conversation. Only the final primary reply
 * is retained; thinking and tool output never enter it.
 *
 * A turn opens on the first sign of one — the streaming flag or any transcript
 * event — because a summary update and a transcript event can reach here in
 * either order, and a reply that opened no turn would be reported as silence.
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
    this.open(event.appSessionId);
    const turn = this.turns.get(event.appSessionId);
    if (!turn) return;
    if (event.kind === 'tool_call') {
      // A pre-tool explanation is not the final report.
      turn.text = '';
    } else if (event.kind === 'text') {
      turn.text = (turn.text + (event.text ?? '')).slice(-8_192);
    } else if (event.kind === 'error') {
      turn.error = (event.text ?? '').slice(0, 600);
    }
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
