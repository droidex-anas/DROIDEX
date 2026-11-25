import type { SessionRole, TranscriptEvent } from '@droidex/protocol';
import { SessionTranscriptReader } from '../sessionTranscript.js';

export function readFullTranscript(
  appSessionId: string,
  providerSessionId: string,
  path: string,
  role: SessionRole,
): TranscriptEvent[] {
  return new SessionTranscriptReader(
    appSessionId,
    providerSessionId,
    path,
    role,
    true,
  ).windowBackward(Number.MAX_SAFE_INTEGER, 0).events;
}
