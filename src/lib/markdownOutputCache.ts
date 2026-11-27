import type { ReactElement } from 'react';

// A byte-bounded LRU of rendered markdown output trees, shared across rows,
// mounts and sessions. The virtualizer mounts about a viewport plus overscan
// per pass, so scrolling the same rows re-parses them every time unless the
// trees survive unmounting. Two mebibytes of source text covers many screens
// of back-scroll; the transcripts themselves are already several times that.
export const MARKDOWN_OUTPUT_CACHE_BYTE_BUDGET = 2 * 1024 * 1024;

// Every input that changes the output tree. Fence building state and file
// handlers are deliberately absent: they reach components through context at
// render time, never through the shared tree.
export interface MarkdownOutputVariant {
  specMode: boolean;
  breaks: boolean;
  allowImages: boolean;
}

interface CacheEntry {
  weightBytes: number;
  element: ReactElement;
}

// Map iteration order is insertion order, so the first key is always the
// least recently used once hits refresh their entry to the end.
const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

function cacheKey(source: string, variant: MarkdownOutputVariant): string {
  const bits = `${variant.specMode ? 's' : 'c'}${variant.breaks ? 'b' : '-'}${variant.allowImages ? 'i' : '-'}`;
  return `${bits}\n${source}`;
}

/**
 * The output tree for a settled markdown source, parsed once per unique
 * (source, variant) and shared by every later mount. `render` runs only on a
 * miss, so counting its invocations observes the cache. React element trees
 * are immutable, so sharing one across any number of mounts is safe; nested
 * components still mount fresh with their own state.
 */
export function cachedMarkdownOutputTree(
  source: string,
  variant: MarkdownOutputVariant,
  render: () => ReactElement,
): ReactElement {
  const key = cacheKey(source, variant);
  const hit = entries.get(key);
  if (hit) {
    entries.delete(key);
    entries.set(key, hit);
    return hit.element;
  }
  const element = render();
  const weightBytes = Math.max(source.length, 1);
  entries.set(key, { weightBytes, element });
  totalBytes += weightBytes;
  while (totalBytes > MARKDOWN_OUTPUT_CACHE_BYTE_BUDGET && entries.size > 1) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    totalBytes -= entries.get(oldestKey)?.weightBytes ?? 0;
    entries.delete(oldestKey);
  }
  return element;
}

export function resetMarkdownOutputCacheForTest(): void {
  entries.clear();
  totalBytes = 0;
}
