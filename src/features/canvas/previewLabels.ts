// What one frame says when it has no mounted document. These rules are about
// build state rather than presentation, and a frame's claim has to be true:
// promising a rebuild that nothing queued is worse than saying the preview is
// gone.

import type { CanvasBuildState } from './protocol';

/**
 * What a frame without a mounted document should say. Only a miss for the
 * revision the frame holds as `ready` is being built again: that read queues the
 * work. A miss for a `failed` frame's fallback queues nothing, and promising a
 * rebuild there would be a lie.
 */
export function missingLabel(
  state: 'loading' | 'missing' | 'unreadable',
  build: CanvasBuildState,
): string {
  if (state === 'loading') return 'Loading this preview…';
  if (state === 'unreadable') return 'This preview could not be read.';
  return build.status === 'ready'
    ? 'Building this preview again…'
    : 'The last working preview is no longer available.';
}

/** The revision whose artifact this frame shows, if any is worth asking for. */
export function previewRevisionId(build: CanvasBuildState): string | null {
  if (build.status === 'ready') return build.revisionId;
  if (build.status === 'failed') return build.lastWorkingRevisionId;
  return null;
}

/** What a frame with nothing to show yet is waiting for. */
export function waitingLabel(build: CanvasBuildState): string {
  switch (build.status) {
    case 'building':
      return 'Building this design…';
    case 'cancelled':
      return 'This build was cancelled.';
    case 'failed':
      return 'This design has no working preview yet.';
    default:
      return 'Waiting to build…';
  }
}
