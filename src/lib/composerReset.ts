// The composer consumes a seed once by comparing ids, so two seeds created in
// the same millisecond must still differ: the id is a monotonic sequence rather
// than a timestamp.
let seedSequence = 0;

export type ComposerSeed = ReturnType<typeof createComposerSeed>;

// While the agent works, a steered prompt reaches it at its next step and a
// queued one goes out after the turn. With no turn running, both just send.
export type SubmitMode = 'queue' | 'steer';

// Enter submits in the mode the user chose; Cmd/Ctrl+Enter in the other.
export function submitModeForEnter(enterMode: SubmitMode, withCommand: boolean): SubmitMode {
  if (!withCommand) return enterMode;
  return enterMode === 'steer' ? 'queue' : 'steer';
}

// A seed goes to the composer of its chat, or with a null chat to the new-chat
// draft in the tile `draftTileId`. One from the browser's prompt box leaves the
// focus where it is, and one it sends goes out as that composer's own prompt,
// in the mode it was sent with.
export function createComposerSeed(
  text: string,
  replace = false,
  {
    appSessionId = null,
    draftTileId = null,
    send = null,
    focus = true,
  }: {
    appSessionId?: string | null;
    draftTileId?: string | null;
    send?: SubmitMode | null;
    focus?: boolean;
  } = {},
) {
  seedSequence += 1;
  return { text, id: seedSequence, replace, appSessionId, draftTileId, send, focus };
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
