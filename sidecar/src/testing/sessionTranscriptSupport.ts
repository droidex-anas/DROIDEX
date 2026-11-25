import type { SessionRole, TranscriptEvent } from '@droidex/protocol';
import { SessionTranscriptReader } from '../sessionTranscript.js';

export async function readFullTranscript(
  appSessionId: string,
  providerSessionId: string,
  path: string,
  role: SessionRole,
): Promise<TranscriptEvent[]> {
  const reader = await SessionTranscriptReader.open(
    appSessionId,
    providerSessionId,
    path,
    role,
    true,
  );
  return reader.windowBackward(Number.MAX_SAFE_INTEGER, 0).events;
}
