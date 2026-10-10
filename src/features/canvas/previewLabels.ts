// What one frame says when it has no mounted document. These rules are about
// build state rather than presentation, and a frame's claim has to be true:
// promising a rebuild that nothing queued is worse than saying the preview is
// gone, and a frame nobody is writing must not shimmer as though someone were.

import type { CanvasBuildState, CanvasDiagnostic, CanvasFrame } from './protocol';

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

/** Each frame's design that is on show: its working revision, or the one it last showed. */
export type ShownRevisions = ReadonlyMap<string, string>;

export const NO_SHOWN_REVISIONS: ShownRevisions = new Map();

/**
 * The revision each frame shows. A frame with a working revision shows it; one
 * whose newer revision is still queued or building keeps showing the design it
 * showed before, so a revision never blanks the frame while it builds. A frame
 * that failed with nothing older, or lost its source, shows nothing. Answers
 * `previous` itself when nothing changed, so a caller can tell.
 */
export function shownRevisions(
  previous: ShownRevisions,
  frames: readonly Pick<CanvasFrame, 'designId' | 'build'>[],
): ShownRevisions {
  const next = new Map<string, string>();
  for (const { designId, build } of frames) {
    const shown = previewRevisionId(build) ?? (isPending(build) ? previous.get(designId) : null);
    if (shown) next.set(designId, shown);
  }
  if (next.size !== previous.size) return next;
  for (const [designId, revisionId] of next) {
    if (previous.get(designId) !== revisionId) return next;
  }
  return previous;
}

/** A newer revision that has not finished building yet. */
export function isPending(build: CanvasBuildState): boolean {
  return build.status === 'pending' || build.status === 'building' || build.status === 'cancelled';
}

/** What a frame's sheet shows while it holds no live preview. */
export type SheetState =
  /** Someone is working on it now: the stage name shimmers. */
  | { kind: 'busy'; stage: 'writing' | 'building' }
  | { kind: 'note'; title: string; detail: string }
  | { kind: 'failed'; diagnostics: CanvasDiagnostic[] }
  /** It has a working revision that is not running: its last picture, if any. */
  | { kind: 'still'; revisionId: string; detail: string };

/**
 * `shown` is the revision the frame shows (see `shownRevisions`).
 * `agentWorking` is whether this chat's agent has a turn running. A frame with
 * no source is being written only while it does; otherwise it is empty.
 * `released` means the frame held a live slot and lost it, so returning to it
 * restarts the design from its own beginning.
 */
export function sheetState(
  frame: Pick<CanvasFrame, 'revisionId' | 'build'>,
  shown: string | null,
  agentWorking: boolean,
  released: boolean,
): SheetState {
  const { build } = frame;
  if (frame.revisionId === null)
    return agentWorking
      ? { kind: 'busy', stage: 'writing' }
      : { kind: 'note', title: 'Empty frame', detail: 'Nothing has been written to it yet.' };
  if (shown !== null)
    return {
      kind: 'still',
      revisionId: shown,
      detail: released
        ? 'Paused to keep four previews running. Select it to run it again.'
        : 'Select it to run its preview.',
    };
  switch (build.status) {
    case 'building':
      return { kind: 'busy', stage: 'building' };
    case 'failed':
      return { kind: 'failed', diagnostics: build.diagnostics };
    case 'cancelled':
      return { kind: 'note', title: 'Build cancelled', detail: 'Its next change builds it again.' };
    default:
      return { kind: 'note', title: 'Waiting to build', detail: 'It builds when a slot is free.' };
  }
}

/** Where a diagnostic points, for a person: "main.tsx · line 12". */
export function diagnosticPlace(diagnostic: CanvasDiagnostic): string | null {
  if (!diagnostic.file) return null;
  return diagnostic.line ? `${diagnostic.file} · line ${String(diagnostic.line)}` : diagnostic.file;
}
