import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCachedSessionSummary,
  serializeCachedSessionSummary,
} from './sessionFileSummaryCache.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

test('cached session summaries accept the complete canonical contract', () => {
  const value = sessionSummary({ cwd: '/repo', tokensIn: 1, tokensOut: 2, contextTokens: 3 });
  assert.deepEqual(parseCachedSessionSummary(serializeCachedSessionSummary(value)), value);
});

test('cached session summaries reject malformed required arrays, discriminants and inherited keys', () => {
  for (const invalid of [
    { ...sessionSummary(), features: undefined },
    { ...sessionSummary(), phase: 'sleeping' },
    { ...sessionSummary(), reasoningEffort: 'extreme' },
    { ...sessionSummary(), contextAccuracy: 'guessed' },
    { ...sessionSummary(), workspaceKind: 'repository' },
    // An inherited Object.prototype key is not a reasoning effort.
    { ...sessionSummary(), reasoningEffort: 'toString' },
  ]) {
    assert.equal(
      parseCachedSessionSummary(JSON.stringify({ cacheVersion: 2, summary: invalid })),
      undefined,
    );
  }
});

test('only SQL NULL represents an intentionally excluded session summary', () => {
  assert.equal(parseCachedSessionSummary(null), null);
  for (const corruptValue of [undefined, 1, new Uint8Array([1, 2, 3]), {}]) {
    assert.equal(parseCachedSessionSummary(corruptValue), undefined);
  }
});
