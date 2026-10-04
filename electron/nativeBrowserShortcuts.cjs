// A browser page with keyboard focus receives every key press, so the app's
// own chords never reach the app window. The renderer lists the chords it acts
// on; a matching press is taken from the page and handed back to the renderer.

const MAX_CHORDS = 64;
const MAX_KEY_LENGTH = 32;
const MODIFIERS = ['meta', 'control', 'alt', 'shift'];

function createNativeBrowserShortcuts({ getMainWindow }) {
  let chords = [];

  function setChords(next) {
    chords = Array.isArray(next) ? next.slice(0, MAX_CHORDS).filter(isChord) : [];
  }

  function handleInput(event, input) {
    if (input.type !== 'keyDown' || !chords.some((chord) => matches(chord, input))) return;
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
  return isKeyName(value.key) && (value.code === null || isKeyName(value.code));
}

function isKeyName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}

function matches(chord, input) {
  if (!MODIFIERS.every((name) => input[name] === chord[name])) return false;
  if (chord.code !== null) return input.code === chord.code;
  return input.key.toUpperCase() === chord.key.toUpperCase();
}

module.exports = { createNativeBrowserShortcuts };
