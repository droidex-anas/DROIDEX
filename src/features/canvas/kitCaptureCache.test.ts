import assert from 'node:assert/strict';
import test from 'node:test';
import { KitCaptureCache } from './kitCaptureCache';

const BUDGET_CHARS = 10;

test('failed reads display null, trim with entries, and are replaced by settled results', () => {
  const cache = new KitCaptureCache(BUDGET_CHARS, 1);
  cache.fail('old');
  assert.equal(cache.get('old'), null);
  assert.equal(cache.needsRead('old'), true);
  cache.fail('new');
  assert.equal(cache.has('old'), false);
  assert.equal(cache.get('old'), undefined);
  cache.set('old', null);
  assert.equal(cache.has('new'), false);
  assert.equal(cache.needsRead('old'), false);
  cache.fail('old');
  cache.set('old', 'url!');
  assert.equal(cache.get('old'), 'url!');
  assert.equal(cache.needsRead('old'), false);
  assert.equal(cache.retainedChars, 4);
});

test('absent captures are bounded, oldest first, without evicting held entries', async () => {
  const cache = new KitCaptureCache(BUDGET_CHARS, 2);
  const release = cache.hold('held');
  cache.set('held', null);
  cache.set('old', null);
  cache.set('new', null);
  assert.equal(cache.has('old'), false);
  assert.equal(cache.get('held'), null);
  assert.equal(cache.get('new'), null);
  const releaseNew = cache.hold('new');
  const releaseLatest = cache.hold('latest');
  cache.set('latest', null);
  assert.equal(cache.get('held'), null);
  release();
  await Promise.resolve();
  assert.equal(cache.has('held'), false);
  releaseNew();
  releaseLatest();
});

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
