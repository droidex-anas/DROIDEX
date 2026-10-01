// Keys and chords for agent typing, sent through CDP as trusted key events.

const { send } = require('./browserFrames.cjs');

const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;
const MODIFIERS = {
  alt: ALT,
  option: ALT,
  ctrl: CONTROL,
  control: CONTROL,
  meta: META,
  cmd: META,
  command: META,
  shift: SHIFT,
};
// [key, code, keyCode, text]
const NAMED_KEYS = {
  enter: ['Enter', 'Enter', 13, '\r'],
  tab: ['Tab', 'Tab', 9],
  escape: ['Escape', 'Escape', 27],
  esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46],
  space: [' ', 'Space', 32, ' '],
  arrowup: ['ArrowUp', 'ArrowUp', 38],
  arrowdown: ['ArrowDown', 'ArrowDown', 40],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37],
  arrowright: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36],
  end: ['End', 'End', 35],
  pageup: ['PageUp', 'PageUp', 33],
  pagedown: ['PageDown', 'PageDown', 34],
};
// On macOS a Meta chord edits only when Chromium is given the command.
const MAC_COMMANDS = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo' };

// A key or chord such as "Enter", "a", "+", "Shift+Tab" or "cmd+a".
function keyOf(spec) {
  const parts = String(spec ?? '')
    .split(/\+(?=.)/)
    .map((part) => part.trim())
    .filter(Boolean);
  const name = parts.pop() ?? '';
  const modifiers = modifiersOf(parts);
  const named = NAMED_KEYS[name.toLowerCase()];
  let key;
  let code;
  let keyCode;
  let text;
  if (named) {
    [key, code, keyCode, text] = named;
  } else if (name.length === 1) {
    const upper = name.toUpperCase();
    key = modifiers & SHIFT ? upper : name;
    code = /[a-z]/i.test(name) ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : undefined;
    // A symbol's character code is another key's code ("%" is ArrowLeft's).
    keyCode = code ? upper.charCodeAt(0) : 0;
    text = key;
  } else {
    throw new Error(
      `Unknown key "${name}"; use one character or a name such as Enter, Tab or ArrowDown.`,
    );
  }
  // A chord with Control or Meta is a shortcut, not text.
  if (modifiers & (CONTROL | META)) text = undefined;
  let commands;
  if (modifiers & META && process.platform === 'darwin') {
    const command =
      name.toLowerCase() === 'z' && modifiers & SHIFT ? 'redo' : MAC_COMMANDS[name.toLowerCase()];
    if (command) commands = [command];
  }
  return { key, code, windowsVirtualKeyCode: keyCode, modifiers, text, commands };
}

function modifiersOf(names) {
  let modifiers = 0;
  for (const name of names ?? []) {
    const bit = MODIFIERS[String(name).toLowerCase()];
    if (!bit) throw new Error(`Unknown modifier "${name}"; use Alt, Control, Meta or Shift.`);
    modifiers |= bit;
  }
  return modifiers;
}

async function pressOn(dbg, sessionId, key) {
  const { text, commands, ...base } = key;
  await send(dbg, sessionId, 'Input.dispatchKeyEvent', {
    ...base,
    type: text ? 'keyDown' : 'rawKeyDown',
    text,
    unmodifiedText: text,
    commands,
  });
  await send(dbg, sessionId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

module.exports = { keyOf, modifiersOf, pressOn };
