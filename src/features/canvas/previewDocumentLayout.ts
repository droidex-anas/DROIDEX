// Which elements a design's preview guest draws and whether a run of them
// shows. Every element the page draws gets a key from its depth, tag and
// class, so the keys of two renders tell which run of elements the later one
// added, and the guest then says whether the frame shows that run.

import { readAnswer, readRect, record } from './previewDocument';
import type { FrameRect } from './protocol';

/** Keys one answer may hold, as the reporter caps them. */
const MAX_PREVIEW_ELEMENT_KEYS = 2000;
/** Bytes one keys answer may measure, as the intermediate accepts it. */
const MAX_PREVIEW_ELEMENTS_BYTES = MAX_PREVIEW_ELEMENT_KEYS * 10 + 1024;
const KEY = /^[0-9a-z]{1,7}$/;

/** A key for each element the page draws, in document order, or `over` for a page past the cap. */
export type PreviewElementKeys = readonly string[] | 'over';

/** A run of the page's elements in document order. */
export interface PreviewElementRun {
  from: number;
  count: number;
}

/** Its box in the design's pixels, or `unseen` where the frame does not show it. */
export type PreviewShown = FrameRect | 'unseen';

export const PREVIEW_ELEMENTS_SCRIPT = 'globalThis.__droidexCanvasPreview.elements()';

/** The keys answer, or null when it is not one. */
export function readPreviewElementKeys(value: unknown): PreviewElementKeys | null {
  const parsed = readAnswer(value, MAX_PREVIEW_ELEMENTS_BYTES);
  if (!record(parsed)) return null;
  if (parsed.over === true) return 'over';
  const { keys } = parsed;
  if (!Array.isArray(keys) || keys.length > MAX_PREVIEW_ELEMENT_KEYS) return null;
  return keys.every((key) => typeof key === 'string' && KEY.test(key)) ? (keys as string[]) : null;
}

/** Asks whether the frame shows a run of its elements; the call itself answers. */
export function previewShownScript(run: PreviewElementRun): string {
  return `globalThis.__droidexCanvasPreview.shown(${JSON.stringify(run)})`;
}

/** A shown answer, or null when it is not one. */
export function readPreviewShown(value: unknown): PreviewShown | null {
  const parsed = readAnswer(value);
  return parsed === false ? 'unseen' : readRect(parsed);
}

/**
 * The run of elements `after` has where `before` does not: what lies between
 * the keys the two start and end with in common. Null when `after` adds none.
 * Among alike elements it is the last of them, as an add after its twin is.
 */
export function addedRun(
  before: readonly string[],
  after: readonly string[],
): PreviewElementRun | null {
  const most = Math.min(before.length, after.length);
  let head = 0;
  while (head < most && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < most - head && before.at(-1 - tail) === after.at(-1 - tail)) tail += 1;
  const added = after.length - head - tail;
  return added > 0 ? { from: head, count: added } : null;
}
