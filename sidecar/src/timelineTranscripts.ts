import type { SessionSummary, TranscriptEvent } from './protocol.js';
import { appendSessionNotice } from './sessionNotices.js';
import { errMsg } from './sessionHelpers.js';

// Native providers store the full transcript; Droid stores only app notices
// separately from its harness-owned session file.
export interface TimelineTranscript {
  /** The file it writes, which the history index learns of when the session closes. */
  readonly path: string;
  appendPrompt(text: string): void;
  append(event: TranscriptEvent): void;
  flush(): void;
}

export class TimelineTranscripts {
  private readonly byId = new Map<string, TimelineTranscript>();

  constructor(private readonly summary: (appSessionId: string) => SessionSummary | undefined) {}

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

  path(appSessionId: string): string | undefined {
    return this.byId.get(appSessionId)?.path;
  }

  recordPrompt(appSessionId: string, prompt: string): void {
    this.byId.get(appSessionId)?.appendPrompt(prompt);
  }

  // After coalescing, so one stored block is one settled run of output. A write
  // failure is reported and never blocks the live event.
  append(event: TranscriptEvent, onError: (message: string) => void): void {
    const transcript = this.byId.get(event.appSessionId);
    try {
      if (transcript) transcript.append(event);
      else if (
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

  flush(appSessionId: string): void {
    this.byId.get(appSessionId)?.flush();
  }
}
