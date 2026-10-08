// The composer consumes a seed once by comparing ids, so two seeds created in
// the same millisecond must still differ: the id is a monotonic sequence rather
// than a timestamp.
import type { QueuedPrompt } from '../hooks/useStore';

let seedSequence = 0;

export type ComposerSeed = ReturnType<typeof createComposerSeed>;

// A seed goes to the composer of its chat, or with a null chat to the new-chat
// draft in the tile `draftTileId`. One from the browser's prompt box leaves the
// focus where it is, and one it sends goes out as that composer's own prompt.
export function createComposerSeed(
  text: string,
  replace = false,
  {
    appSessionId = null,
    draftTileId = null,
    send = false,
    focus = true,
    prompt,
  }: {
    appSessionId?: string | null;
    draftTileId?: string | null;
    send?: boolean;
    focus?: boolean;
    // A whole prompt to restore with its chips and replies, e.g. a steer the
    // user took back.
    prompt?: QueuedPrompt | undefined;
  } = {},
) {
  seedSequence += 1;
  return { text, id: seedSequence, replace, appSessionId, draftTileId, send, focus, prompt };
}

/**
 * Post-submit composer reset. Image chips always clear: the submit path
 * waited out every in-flight encode, so each made the prompt. The
 * text/file/skill draft resets only when the composer went untouched between
 * snapshot and send — anything typed or staged while images finished
 * encoding belongs to the next prompt and must not be wiped.
 */
export function resetComposerAfterSubmit(opts: {
  draftUntouched: boolean;
  clearImages: () => void;
  resetDraft: () => void;
}): void {
  opts.clearImages();
  if (opts.draftUntouched) opts.resetDraft();
}

export function composerTextAfterSeed(current: string, seed: string, replace: boolean): string {
  if (replace || !current.trim()) return seed;
  return `${current.trimEnd()}\n\n${seed}`;
}
