import assert from 'node:assert/strict';
import test from 'node:test';
import { dismissToast, pushToast, subscribeToasts } from './toast';

test('subscribers see pushes and targeted dismissals until they unsubscribe', () => {
  const snapshots: { id: number; message: string; variant: string; ttl: number }[][] = [];
  const unsubscribe = subscribeToasts((toasts) => {
    snapshots.push(toasts);
  });
  assert.deepEqual(snapshots, [[]]);

  const first = pushToast('Opened VS Code', 'success', 0);
  const second = pushToast('two', 'error', 0);
  assert.deepEqual(snapshots.at(-1), [
    { id: first, message: 'Opened VS Code', variant: 'success', ttl: 0 },
    { id: second, message: 'two', variant: 'error', ttl: 0 },
  ]);

  dismissToast(first);
  assert.deepEqual(
    snapshots.at(-1)?.map((toast) => toast.id),
    [second],
  );

  unsubscribe();
  pushToast('ignored', 'info', 0);
  assert.equal(snapshots.length, 4);
});
