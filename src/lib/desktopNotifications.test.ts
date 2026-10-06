import test from 'node:test';
import assert from 'node:assert/strict';
import { notify } from './desktop';

async function notifyWithWindow(window: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: window,
  });
  try {
    return await notify('DROIDEX', 'Finished');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('notify returns the desktop bridge delivery result, or unsupported without a bridge', async () => {
  const expected = { shown: false, reason: 'timeout' };
  assert.deepEqual(
    await notifyWithWindow({ droidControl: { notify: async () => expected } }),
    expected,
  );
  assert.deepEqual(await notifyWithWindow(undefined), { shown: false, reason: 'unsupported' });
});
