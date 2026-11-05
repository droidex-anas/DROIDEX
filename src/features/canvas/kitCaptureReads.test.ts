import assert from 'node:assert/strict';
import test from 'node:test';
import { KitCaptureReads } from './kitCaptureReads';

test('a read whose tiles left before it was sent gives its slot to the next document', async () => {
  const reads = new KitCaptureReads(2);
  const sent: string[] = [];
  const settles = new Map<string, () => void>();
  const read = (key: string) => () => {
    sent.push(key);
    return new Promise<void>((resolve) => settles.set(key, resolve));
  };

  for (const key of ['old-a', 'old-b', 'old-c', 'old-d']) reads.request(key, read(key));
  // The old document closes: its waiting reads are dropped, its sent ones settle as usual.
  for (const key of ['old-a', 'old-b', 'old-c', 'old-d']) reads.cancel(key);
  reads.request('new-a', read('new-a'));
  reads.request('new-b', read('new-b'));
  assert.deepEqual(sent, ['old-a', 'old-b']);

  settles.get('old-a')?.();
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['old-a', 'old-b', 'new-a']);
});
