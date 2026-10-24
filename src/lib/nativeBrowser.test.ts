import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forwardNativeBrowserShortcuts,
  watchNativeBrowser,
  type NativeBrowserFrame,
} from './nativeBrowser';
import type { NativeBrowserChord } from './shortcuts';

test('stopping the shortcut forward hands the chords back to the browser page', () => {
  const registered: NativeBrowserChord[][] = [];
  let listening = false;
  const globals = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = globals.window;
  globals.window = {
    droidex: {
      nativeBrowserSetShortcuts: async (chords: NativeBrowserChord[]) => {
        registered.push(chords);
      },
      onNativeBrowserShortcut: () => {
        listening = true;
        return () => {
          listening = false;
        };
      },
    },
  };
  const newTab = { meta: true, control: false, alt: false, shift: false, key: 'T', typed: false };

  try {
    const stop = forwardNativeBrowserShortcuts([newTab], () => undefined);
    assert.deepEqual(registered, [[newTab]]);
    assert.equal(listening, true);

    stop();
    assert.deepEqual(registered, [[newTab], []]);
    assert.equal(listening, false);
  } finally {
    globals.window = previousWindow;
  }
});

test('preview watchers share capture and release all frame listeners when stopped', () => {
  const commands: boolean[] = [];
  const listeners = new Set<(frame: NativeBrowserFrame) => void>();
  const received: string[] = [];
  const globals = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = globals.window;
  globals.window = {
    droidex: {
      nativeBrowserWatch: async (_id: string, watching: boolean) => {
        commands.push(watching);
      },
      onNativeBrowserFrame: (handler: (frame: NativeBrowserFrame) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    },
  };
  const frame = { browserSessionId: 'preview-page', image: 'jpeg', width: 1280, height: 800 };
  try {
    const stopFirst = watchNativeBrowser(frame.browserSessionId, () => received.push('first'));
    const stopSecond = watchNativeBrowser(frame.browserSessionId, () => received.push('second'));
    assert.deepEqual(commands, [true]);
    for (const listener of listeners) listener(frame);
    assert.deepEqual(received, ['first', 'second']);

    stopFirst();
    stopFirst();
    assert.deepEqual(commands, [true]);
    for (const listener of listeners) listener(frame);
    assert.deepEqual(received, ['first', 'second', 'second']);

    stopSecond();
    assert.deepEqual(commands, [true, false]);
    assert.equal(listeners.size, 0);
    const stopNext = watchNativeBrowser(frame.browserSessionId, () => received.push('next'));
    stopNext();
    assert.deepEqual(commands, [true, false, true, false]);
    assert.equal(listeners.size, 0);
  } finally {
    globals.window = previousWindow;
  }
});
