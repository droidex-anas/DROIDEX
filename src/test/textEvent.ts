import type { TranscriptEvent } from '../types/bridge';

/** A primary text event; tests override only the fields their assertions read. */
export function textEvent(id: string, overrides: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    id,
    appSessionId: 'app-1',
    sourceSessionId: 'primary',
    role: 'primary',
    kind: 'text',
    text: id,
    ts: 1,
    ...overrides,
  };
}
