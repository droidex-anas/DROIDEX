import type { SessionSummary, TranscriptEvent } from './protocol.js';
import { appendSessionNotice } from './sessionNotices.js';
import { errMsg } from './sessionHelpers.js';

// Native providers store the full transcript; Droid stores only app notices
// separately from its harness-owned session file.
export interface TimelineTranscript {
  appendPrompt(text: string): Promise<void>;
  append(event: TranscriptEvent): void | Promise<void>;
  flush(): Promise<void>;
}

export class TimelineTranscripts {
  private readonly byId = new Map<string, TimelineTranscript>();

  constructor(private readonly summary: (appSessionId: string) => SessionSummary | undefined) {}

  use(appSessionId: string, transcript: TimelineTranscript): void {
    this.byId.set(appSessionId, transcript);
  }

  // A failed final write keeps the writer owned and reaches the caller.
  async release(appSessionId: string): Promise<void> {
    const transcript = this.byId.get(appSessionId);
    if (!transcript) return;
    await transcript.flush();
    if (this.byId.get(appSessionId) === transcript) this.byId.delete(appSessionId);
  }

  recordPrompt(appSessionId: string, prompt: string): void | Promise<void> {
    return this.byId.get(appSessionId)?.appendPrompt(prompt);
  }

  // After coalescing, so one stored block is one settled run of output. A write
  // failure is reported and never blocks the live event.
  append(event: TranscriptEvent, onError: (message: string) => void): void {
    const transcript = this.byId.get(event.appSessionId);
    try {
      if (transcript) {
        const writing = transcript.append(event);
        if (writing)
          void writing.catch((error: unknown) => {
            if (this.byId.get(event.appSessionId) === transcript) onError(errMsg(error));
          });
      } else if (
        event.role === 'primary' &&
        (event.modelSwitch || event.errorKind === 'usage_limit')
      ) {
        const summary = this.summary(event.appSessionId);
        if (summary?.provider === 'droid')
          appendSessionNotice(summary.providerSessionId ?? event.appSessionId, event);
      }
    } catch (error) {
      onError(errMsg(error));
    }
  }

  async flush(appSessionId: string): Promise<void> {
    await this.byId.get(appSessionId)?.flush();
  }
}
