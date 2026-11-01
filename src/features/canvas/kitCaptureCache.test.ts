import assert from 'node:assert/strict';
import test from 'node:test';
import { KitCaptureCache } from './kitCaptureCache';

const BUDGET_CHARS = 10;

test('captures stay over the budget while shown and drop to it once let go, oldest first', async () => {
  const cache = new KitCaptureCache(BUDGET_CHARS);
  const releases = ['a', 'b', 'c', 'd'].map((key) => {
    const release = cache.hold(key);
    cache.set(key, 'url!');
    return release;
  });
  // Every tile still shows its capture, so none is let go.
  assert.equal(cache.retainedChars, 16);

  for (const release of releases) release();
  await Promise.resolve();

  assert.ok(cache.retainedChars <= BUDGET_CHARS);
  assert.deepEqual(
    ['a', 'b', 'c', 'd'].filter((key) => cache.has(key)),
    ['c', 'd'],
  );
});

test('a capture let go and shown again at once is kept', async () => {
  const cache = new KitCaptureCache(BUDGET_CHARS);
  const release = cache.hold('a');
  cache.set('a', 'a'.repeat(BUDGET_CHARS + 1));

  release();
  const again = cache.hold('a');
  await Promise.resolve();

  assert.equal(cache.has('a'), true);
  again();
  await Promise.resolve();
  assert.equal(cache.has('a'), false);
});
