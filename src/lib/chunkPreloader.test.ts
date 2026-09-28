import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __loaderCallsForTest,
  __resetChunkPreloaderForTest,
  bindLazySurfaceIntent,
  cancelIdleLazyWarmup,
  preloadLazySurface,
  scheduleIdleLazyWarmup,
} from './chunkPreloader';

test('preloadLazySurface invokes the loader exactly once', () => {
  __resetChunkPreloaderForTest({
    loaders: {
      settings: () => Promise.resolve({ default: () => null }),
    },
  });
  preloadLazySurface('settings');
  preloadLazySurface('settings');
  assert.equal(__loaderCallsForTest().get('settings'), 1);
});

test('intent binding preloads once and cleans up listeners', () => {
  let loads = 0;
  __resetChunkPreloaderForTest({
    loaders: {
      files: () => {
        loads += 1;
        return Promise.resolve({ default: () => null });
      },
    },
  });
  const element = new EventTarget() as HTMLElement;
  const cleanup = bindLazySurfaceIntent('files', element);
  element.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 1);
  cleanup();
  element.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 1);
});

test('failed preloads allow a later retry for intent and idle triggers', async () => {
  let attempts = 0;
  __resetChunkPreloaderForTest({
    loaders: {
      settings: () => {
        attempts += 1;
        return Promise.reject(new Error('network'));
      },
    },
  });
  preloadLazySurface('settings');
  await Promise.resolve();
  preloadLazySurface('settings');
  await Promise.resolve();
  assert.equal(attempts, 2);
});

test('idle warm-up loads one surface per opportunity, yields to work, and keeps intent immediate', () => {
  const calls: string[] = [];
  const surfaces = [
    'settings',
    'commandPalette',
    'files',
    'terminal',
    'review',
    'browser',
    'agents',
  ] as const;
  __resetChunkPreloaderForTest({
    loaders: Object.fromEntries(
      surfaces.map((surface) => [
        surface,
        () => {
          calls.push(surface);
          return Promise.resolve();
        },
      ]),
    ),
  });
  const callbacks: IdleRequestCallback[] = [];
  const original = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  const run = (remaining = 10) => {
    const callback = callbacks.shift();
    assert.ok(callback);
    callback({ didTimeout: false, timeRemaining: () => remaining });
  };
  let busy = true;
  try {
    scheduleIdleLazyWarmup(() => busy);
    scheduleIdleLazyWarmup(() => busy);
    assert.equal(callbacks.length, 1);
    run();
    assert.deepEqual(calls, []);
    const element = new EventTarget() as HTMLElement;
    const cleanup = bindLazySurfaceIntent('files', element);
    element.dispatchEvent(new Event('focusin'));
    assert.deepEqual(calls, ['files']);
    cleanup();
    assert.equal(callbacks.length, 0);
    busy = false;
    scheduleIdleLazyWarmup(() => busy);
    run(0);
    assert.deepEqual(calls, ['files']);
    run();
    assert.deepEqual(calls, ['files', 'settings']);
    run();
    assert.deepEqual(calls, ['files', 'settings', 'commandPalette']);
    for (let index = 0; index < 4; index++) run();
    assert.deepEqual(calls, [
      'files',
      'settings',
      'commandPalette',
      'terminal',
      'review',
      'browser',
      'agents',
    ]);
    assert.equal(callbacks.length, 0);
  } finally {
    __resetChunkPreloaderForTest();
    globalThis.requestIdleCallback = original;
  }
});

test('cancelling idle warm-up makes already queued callbacks harmless', () => {
  __resetChunkPreloaderForTest({ loaders: { settings: () => Promise.resolve() } });
  const callbacks: IdleRequestCallback[] = [];
  const original = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  try {
    scheduleIdleLazyWarmup(() => false);
    cancelIdleLazyWarmup();
    scheduleIdleLazyWarmup(() => false);
    callbacks[0]({ didTimeout: false, timeRemaining: () => 10 });
    assert.equal(__loaderCallsForTest().size, 0);
    scheduleIdleLazyWarmup(() => false);
    assert.equal(callbacks.length, 2);
  } finally {
    __resetChunkPreloaderForTest();
    globalThis.requestIdleCallback = original;
  }
});
