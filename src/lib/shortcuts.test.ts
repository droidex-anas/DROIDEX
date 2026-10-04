import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { isTerminalTabShortcut, utilityToolShortcut } from './keyboardShortcuts';
import {
  SHORTCUT_DEFINITIONS,
  chordFromEvent,
  conflictingActions,
  defaultShortcutBindings,
  formatChord,
  matchesChord,
  nativeBrowserChords,
  parseChord,
  serializeChord,
  tabNumberFromEvent,
} from './shortcuts';

// The desktop host is CommonJS: it decides which presses leave a browser page.
const require = createRequire(import.meta.url);
const { createNativeBrowserShortcuts } = require('../../electron/nativeBrowserShortcuts.cjs');

// Node has no Mac user agent, so these exercise the non-Apple branch where the
// primary modifier is Control.

function event(partial: { key: string; code?: string } & Record<string, unknown>) {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: '',
    ...partial,
  } as KeyboardEvent;
}

test('chords, including the numpad plus key, round-trip through parse and serialize', () => {
  for (const { defaultChord } of SHORTCUT_DEFINITIONS) {
    const parsed = parseChord(defaultChord);
    assert.ok(parsed, `${defaultChord} must parse`);
    assert.equal(serializeChord(parsed), defaultChord);
  }
  assert.equal(parseChord('Hyper+B'), null);
  assert.equal(
    serializeChord({ meta: true, ctrl: false, alt: true, shift: true, key: 'B' }),
    'Meta+Alt+Shift+B',
  );

  const chord = chordFromEvent(event({ ctrlKey: true, key: '+', code: 'NumpadAdd' }));
  assert.ok(chord);
  assert.deepEqual(chord, { meta: true, ctrl: false, alt: false, shift: false, key: 'Plus' });
  const serialized = serializeChord(chord);
  assert.equal(serialized, 'Meta+Plus');
  assert.deepEqual(parseChord(serialized), chord);
  assert.equal(
    matchesChord(event({ ctrlKey: true, key: '+', code: 'NumpadAdd' }), serialized),
    true,
  );
});

test('matchesChord reads the physical key, not the character the modifiers produce', () => {
  // Option+\ reports key '«' on a US layout; the binding must still match.
  assert.equal(
    matchesChord(
      event({ ctrlKey: true, altKey: true, key: '«', code: 'Backslash' }),
      'Meta+Alt+\\',
    ),
    true,
  );
  assert.equal(
    matchesChord(event({ ctrlKey: true, key: '\\', code: 'Backslash' }), 'Meta+\\'),
    true,
  );
  assert.equal(
    matchesChord(event({ metaKey: true, key: '\\', code: 'Backslash' }), 'Meta+\\'),
    false,
  );
  assert.equal(
    matchesChord(event({ ctrlKey: true, shiftKey: true, key: 'B', code: 'KeyB' }), 'Meta+B'),
    false,
  );
});

test('chordFromEvent ignores modifier-only presses and stores Ctrl as the primary modifier', () => {
  assert.equal(chordFromEvent(event({ key: 'Control', code: 'ControlLeft' })), null);
  assert.deepEqual(chordFromEvent(event({ ctrlKey: true, key: 'j', code: 'KeyJ' })), {
    meta: true,
    ctrl: false,
    alt: false,
    shift: false,
    key: 'J',
  });
});

test('formatChord collapses the primary and control modifiers off macOS', () => {
  assert.equal(formatChord('Meta+Shift+B'), 'Ctrl+Shift+B');
  assert.equal(formatChord('Meta+Ctrl+B'), 'Ctrl+B');
});

test('defaults are collision-free and conflicts are reported both ways', () => {
  const bindings = defaultShortcutBindings();
  for (const { action } of SHORTCUT_DEFINITIONS) {
    assert.deepEqual(conflictingActions(bindings, action), []);
  }
  const clashing = { ...bindings, openSettings: bindings.toggleSidebar };
  assert.deepEqual(
    conflictingActions(clashing, 'openSettings').map((definition) => definition.action),
    ['toggleSidebar'],
  );
  assert.deepEqual(
    conflictingActions(clashing, 'toggleSidebar').map((definition) => definition.action),
    ['openSettings'],
  );
});

test('tabNumberFromEvent reads only the bare primary-modifier digits 1 to 9', () => {
  assert.equal(tabNumberFromEvent(event({ ctrlKey: true, key: '3', code: 'Digit3' })), 3);
  // Shift+3 reports '#' but is a different chord.
  assert.equal(
    tabNumberFromEvent(event({ ctrlKey: true, shiftKey: true, key: '#', code: 'Digit3' })),
    null,
  );
  assert.equal(tabNumberFromEvent(event({ ctrlKey: true, key: '0', code: 'Digit0' })), null);
  assert.equal(tabNumberFromEvent(event({ key: '3', code: 'Digit3' })), null);
});

test('a browser page hands the app every bound chord, and nothing the app ignores', () => {
  const bindings = {
    ...defaultShortcutBindings(),
    openSettings: 'Meta+.',
    closeTile: 'Meta+Alt+7',
    toggleUtilityPane: 'Meta+F5',
    previousTile: 'Meta+§',
  };
  const isBound = (press: KeyboardEvent) =>
    Object.values(bindings).some((chord) => matchesChord(press, chord)) ||
    tabNumberFromEvent(press) !== null;
  // The fixed tool chords also take extra modifiers in the app; the page keeps those.
  const appActs = (press: KeyboardEvent) =>
    isBound(press) || isTerminalTabShortcut(press) || utilityToolShortcut(press) !== null;

  const forwarded: unknown[] = [];
  const host = createNativeBrowserShortcuts({
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        focus: () => undefined,
        send: (_channel: string, press: unknown) => forwarded.push(press),
      },
    }),
  });
  host.setChords(nativeBrowserChords(bindings));
  const hostForwards = (press: KeyboardEvent) => {
    const before = forwarded.length;
    host.handleInput(
      { preventDefault: () => undefined },
      {
        type: 'keyDown',
        key: press.key,
        code: press.code,
        meta: press.metaKey,
        control: press.ctrlKey,
        alt: press.altKey,
        shift: press.shiftKey,
        isAutoRepeat: false,
        isComposing: false,
      },
    );
    return forwarded.length > before;
  };

  // Each physical key with what it types, including other layouts and the numpad.
  const keys = [
    ['KeyT', 't'],
    ['KeyB', 'b'],
    ['KeyB', 'x'],
    ['KeyN', 'b'],
    ['KeyF', 'f'],
    ['KeyR', 'r'],
    ['Digit1', '1'],
    ['Digit1', '&'],
    ['Digit7', '7'],
    ['Numpad7', '7'],
    ['Period', '.'],
    ['NumpadDecimal', '.'],
    ['NumpadAdd', '+'],
    ['Backslash', '\\'],
    ['IntlBackslash', '\\'],
    ['IntlBackslash', '§'],
    ['IntlBackslash', '`'],
    ['Backquote', '`'],
    ['Backquote', '^'],
    ['BracketRight', ']'],
    ['Space', ' '],
    ['F5', 'F5'],
    ['Enter', 'Enter'],
  ];
  const mismatches: string[] = [];
  for (const [code, key] of keys) {
    for (let held = 0; held < 16; held++) {
      const press = event({
        key,
        code,
        metaKey: (held & 1) !== 0,
        ctrlKey: (held & 2) !== 0,
        altKey: (held & 4) !== 0,
        shiftKey: (held & 8) !== 0,
      });
      const sent = hostForwards(press);
      if (sent ? !appActs(press) : isBound(press))
        mismatches.push(`${code} ${key} ${String(held)}`);
    }
  }
  assert.deepEqual(mismatches, []);

  assert.equal(hostForwards(event({ ctrlKey: true, key: '7', code: 'Numpad7' })), true);
  assert.equal(hostForwards(event({ ctrlKey: true, key: '\\', code: 'IntlBackslash' })), true);
  assert.equal(hostForwards(event({ ctrlKey: true, key: '`', code: 'IntlBackslash' })), true);
  assert.equal(
    hostForwards(event({ metaKey: true, shiftKey: true, key: 'b', code: 'KeyN' })),
    true,
  );
  assert.equal(
    hostForwards(event({ ctrlKey: true, shiftKey: true, key: 'R', code: 'KeyR' })),
    true,
  );
});
