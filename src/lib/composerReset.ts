// The composer consumes a seed once by comparing ids, so two seeds created in
// the same millisecond must still differ: the id is a monotonic sequence rather
// than a timestamp.
let seedSequence = 0;

// A seed from the browser's prompt box belongs to the chat that owns the
// browser, leaves the focus where it is, and one it sends goes out as that
// composer's own prompt.
export function createComposerSeed(
  text: string,
  replace = false,
  {
    appSessionId,
    send = false,
    focus = true,
  }: { appSessionId?: string; send?: boolean; focus?: boolean } = {},
) {
  seedSequence += 1;
  return { text, id: seedSequence, replace, appSessionId, send, focus };
}

// A seed for one chat goes to that chat's composer; any other seed goes to the
// focused tile's.
export function composerSeedFor<Seed extends { appSessionId?: string }>(
  seed: Seed | null,
  appSessionId: string | null,
  activeAppSessionId: string | null,
): Seed | null {
  return seed && (seed.appSessionId ?? activeAppSessionId) === appSessionId ? seed : null;
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
