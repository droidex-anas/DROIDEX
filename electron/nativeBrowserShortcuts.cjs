// A browser page with keyboard focus receives every key press, so the app's
// own chords never reach the app window. The renderer lists the chords it acts
// on; a matching press is taken from the page and handed back to the renderer.

const MAX_CHORDS = 64;
const MAX_KEY_LENGTH = 32;
const MODIFIERS = ['meta', 'control', 'alt', 'shift'];

// keyFromEvent in src/lib/shortcuts.ts names a press the same way, and
// src/lib/shortcuts.test.ts holds the two to the same answers.
const PUNCTUATION_BY_CODE = new Map([
  ['Backslash', '\\'],
  ['Backquote', '`'],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Comma', ','],
  ['Equal', '='],
  ['Minus', '-'],
  ['Period', '.'],
  ['Quote', "'"],
  ['Semicolon', ';'],
  ['Slash', '/'],
  ['Space', 'Space'],
  ['NumpadAdd', 'Plus'],
]);

function createNativeBrowserShortcuts({ getMainWindow }) {
  let chords = [];

  function setChords(next) {
    chords = Array.isArray(next) ? next.slice(0, MAX_CHORDS).filter(isChord) : [];
  }

  function handleInput(event, input) {
    // An input method is still building a character; the press belongs to it.
    if (input.type !== 'keyDown' || input.isComposing) return;
    if (!chords.some((chord) => matches(chord, input))) return;
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    // The chord acts on the app, so typing continues there, as in the tab or
    // composer the chord just opened.
    mainWindow.webContents.focus();
    mainWindow.webContents.send('native-browser-shortcut', {
      key: input.key,
      code: input.code,
      metaKey: input.meta,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift,
      repeat: input.isAutoRepeat,
    });
  }

  return { setChords, handleInput };
}

function isChord(value) {
  if (!value || typeof value !== 'object') return false;
  if (!MODIFIERS.every((name) => typeof value[name] === 'boolean')) return false;
  if (typeof value.typed !== 'boolean') return false;
  return (
    typeof value.key === 'string' && value.key.length > 0 && value.key.length <= MAX_KEY_LENGTH
  );
}

function normalizeKey(key) {
  if (key === ' ') return 'Space';
  if (key === '+') return 'Plus';
  return key.length === 1 ? key.toUpperCase() : key;
}

function keyFromInput(input) {
  const code = input.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return PUNCTUATION_BY_CODE.get(code) ?? normalizeKey(input.key);
}

function matches(chord, input) {
  if (!MODIFIERS.every((name) => input[name] === chord[name])) return false;
  const key = chord.typed ? normalizeKey(input.key) : keyFromInput(input);
  return key === chord.key;
}

module.exports = { createNativeBrowserShortcuts };
