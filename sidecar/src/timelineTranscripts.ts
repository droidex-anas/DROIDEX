import type { TranscriptEvent } from './protocol.js';
import { errMsg } from './sessionHelpers.js';

// Durable transcript for a session whose provider keeps no session file of its
// own. Registered per live session by the manager, which owns the provider
// decision; a Droid session has none, and every call here is a no-op for it.
export interface TimelineTranscript {
  appendPrompt(text: string): void;
  append(event: TranscriptEvent): void;
  flush(): void;
}

export class TimelineTranscripts {
  private readonly byId = new Map<string, TimelineTranscript>();

  use(appSessionId: string, transcript: TimelineTranscript): void {
    this.byId.set(appSessionId, transcript);
  }

  // Flushes before forgetting, so a failed final write keeps its buffered
  // message and the failure reaches the caller.
  release(appSessionId: string): void {
    const transcript = this.byId.get(appSessionId);
    if (!transcript) return;
    transcript.flush();
    this.byId.delete(appSessionId);
  }

  recordPrompt(appSessionId: string, prompt: string): void {
    this.byId.get(appSessionId)?.appendPrompt(prompt);
  }

  // After coalescing, so one stored block is one settled run of output. A write
  // failure is reported and never blocks the live event.
  append(event: TranscriptEvent, onError: (message: string) => void): void {
    const transcript = this.byId.get(event.appSessionId);
    if (!transcript) return;
    try {
      transcript.append(event);
    } catch (error) {
      onError(errMsg(error));
    }
  }

  flush(appSessionId: string): void {
    this.byId.get(appSessionId)?.flush();
  }
}
