import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import { digestTranscript, type ActivityDigest } from '../../lib/activityDigest';
import type { TranscriptEvent } from '../../types/bridge';

/* The last step of the threads a caller names, and only those. The inbox's own
   digest hook walks every transcript the window holds, which is the right cost
   for an inbox and far too much for a thread line or the board. The selection
   changes only when one of the named transcripts does, so a caller that names
   a thread is not redrawn while another conversation streams.
   Digests are pure, so one per transcript array is cached by its identity. */

const cache = new WeakMap<readonly TranscriptEvent[], ActivityDigest | null>();

export function useThreadDigests(
  appSessionIds: readonly string[],
): Partial<Record<string, ActivityDigest>> {
  return useStoreSelector(
    (state) => {
      const digests: Record<string, ActivityDigest> = {};
      const transcripts: Partial<Record<string, readonly TranscriptEvent[]>> = state.transcripts;
      for (const id of appSessionIds) {
        const events = transcripts[id];
        if (!events) continue;
        const digest = cache.get(events) ?? digestTranscript(events);
        cache.set(events, digest);
        if (digest) digests[id] = digest;
      }
      return digests;
    },
    (left, right) =>
      shallowEqual(left as Record<string, unknown>, right as Record<string, unknown>),
  );
}
