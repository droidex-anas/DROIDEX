import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forwardNativeBrowserShortcuts,
  nativeBrowserAgentActionFromRequest,
} from './nativeBrowser';
import type { NativeBrowserChord } from './shortcuts';

test('native browser agent actions preserve selector and pointer fields', () => {
  const action = nativeBrowserAgentActionFromRequest({
    requestId: 'request-1',
    appSessionId: 'app-1',
    browserSessionId: 'browser-1',
    action: 'selectOption',
    selector: '#country',
    x: 120,
    y: 240,
    text: 'Canada',
    direction: 'down',
    pixels: 300,
  });

  assert.deepEqual(action, {
    requestId: 'request-1',
    browserSessionId: 'browser-1',
    action: 'selectOption',
    x: 120,
    y: 240,
    selector: '#country',
    text: 'Canada',
    key: undefined,
    direction: 'down',
    pixels: 300,
  });
});

test('stopping the shortcut forward hands the chords back to the browser page', () => {
  const registered: NativeBrowserChord[][] = [];
  let listening = false;
  const globals = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = globals.window;
  globals.window = {
    droidControl: {
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
