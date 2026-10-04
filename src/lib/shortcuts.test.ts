import test from 'node:test';
import assert from 'node:assert/strict';

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

test('the native browser hands back every bound chord and tab digit as the press that matches it', () => {
  const bindings = { ...defaultShortcutBindings(), openSettings: 'Meta+F5' };
  const chords = nativeBrowserChords(bindings);
  assert.equal(chords.length, SHORTCUT_DEFINITIONS.length + 9);
  for (const [index, binding] of Object.values(bindings).entries()) {
    const chord = chords[index];
    const press = event({
      key: chord.key,
      code: chord.code ?? '',
      metaKey: chord.meta,
      ctrlKey: chord.control,
      altKey: chord.alt,
      shiftKey: chord.shift,
    });
    assert.equal(matchesChord(press, binding), true, binding);
  }
  assert.deepEqual(
    chords.find((chord) => chord.key === ']' && chord.shift),
    { meta: false, control: true, alt: false, shift: true, code: 'BracketRight', key: ']' },
  );
  assert.equal(chords.find((chord) => chord.key === 'F5')?.code, null);
  assert.equal(chords.at(-1)?.code, 'Digit9');
});
