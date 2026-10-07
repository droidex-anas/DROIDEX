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

/**
 * What a frame holding no live preview slot says. A frame with nothing built
 * yet is still waiting to build; one whose design is ready says that opening it
 * is what runs it, and names the reload when a slot was taken away, because the
 * design restarts from its own beginning rather than where the user left it.
 */
export function unmountedLabel(build: CanvasBuildState, released: boolean): string {
  if (previewRevisionId(build) === null) return waitingLabel(build);
  return released
    ? 'This preview was stopped to keep four running. Opening it starts the design again.'
    : 'Open this design to run its preview.';
}
