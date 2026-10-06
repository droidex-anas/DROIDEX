import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeVisibilityChange } from './useDocumentVisible';

test('subscribeVisibilityChange wires visibilitychange and cleans up completely', () => {
  const listeners: Record<string, Array<() => void>> = {};
  const fakeDocument = {
    addEventListener(type: string, listener: () => void) {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
  };
  const globalRef = globalThis as { document?: unknown };
  const original = globalRef.document;
  globalRef.document = fakeDocument;
  try {
    let notifyCalls = 0;
    const unsubscribe = subscribeVisibilityChange(() => {
      notifyCalls += 1;
    });

    assert.equal(listeners.visibilitychange.length, 1);
    listeners.visibilitychange[0]();
    assert.equal(notifyCalls, 1);

    unsubscribe();
    assert.equal(listeners.visibilitychange.length, 0);
  } finally {
    if (original === undefined) delete globalRef.document;
    else globalRef.document = original;
  }
});
