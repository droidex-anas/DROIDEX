import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';

import {
  MARKDOWN_OUTPUT_CACHE_BYTE_BUDGET,
  cachedMarkdownOutputTree,
  resetMarkdownOutputCacheForTest,
  type MarkdownOutputVariant,
} from './markdownOutputCache';

const CHAT: MarkdownOutputVariant = { specMode: false, breaks: false, allowImages: true };

// Counts how often the parse behind a source actually runs: a hit never
// re-renders, an eviction forces one more render on the next lookup.
function renderCounts() {
  const counts = new Map<string, number>();
  return {
    counts,
    lookup(source: string, variant: MarkdownOutputVariant = CHAT) {
      return cachedMarkdownOutputTree(source, variant, () => {
        counts.set(source, (counts.get(source) ?? 0) + 1);
        return createElement('p', null, source);
      });
    },
  };
}

test('a source and variant parse once and share one tree across later mounts', () => {
  resetMarkdownOutputCacheForTest();
  const { counts, lookup } = renderCounts();

  const first = lookup('the settled answer');
  const second = lookup('the settled answer');

  assert.equal(counts.get('the settled answer'), 1);
  assert.equal(second, first);
});

test('every output-changing input keys its own tree', () => {
  resetMarkdownOutputCacheForTest();
  const { lookup } = renderCounts();
  const base = lookup('same source');

  for (const variant of [
    { ...CHAT, specMode: true },
    { ...CHAT, breaks: true },
    { ...CHAT, allowImages: false },
  ]) {
    assert.notEqual(lookup('same source', variant), base);
  }
  assert.notEqual(lookup('other source'), base);
});

test('entries past the byte budget evict the least recently used first', () => {
  resetMarkdownOutputCacheForTest();
  // Entries sized so three never fit but two always do: inserting a third
  // evicts exactly one — the least recently used.
  const size = Math.floor((MARKDOWN_OUTPUT_CACHE_BYTE_BUDGET / 3 - 4096) / 8) + 1;
  const source = (marker: string) => marker + 'x'.repeat(size - marker.length);
  const [a, b, c] = [source('a'), source('b'), source('c')];
  const { counts, lookup } = renderCounts();

  lookup(a);
  lookup(b);
  // Refreshing `a` makes `b` the least recently used, so the third insertion
  // must evict `b` alone.
  lookup(a);
  lookup(c);

  lookup(a);
  assert.equal(counts.get(a), 1, 'the refreshed entry survives on its recency');
  lookup(b);
  assert.equal(counts.get(b), 2, 'the least recently used entry was evicted');
});

test('a source too large for the budget renders without entering the cache', () => {
  resetMarkdownOutputCacheForTest();
  const source = 'x'.repeat(MARKDOWN_OUTPUT_CACHE_BYTE_BUDGET);
  const { counts, lookup } = renderCounts();

  lookup(source);
  lookup(source);

  assert.equal(counts.get(source), 2);
});
