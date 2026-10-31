// Keys, chords and text for agent typing. A cross-site frame takes them as
// trusted CDP input on its own session. The top document takes them from
// Electron: CDP input for it follows the app's keyboard focus, so it would
// land in whatever the user is typing in.

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
const ELECTRON_MODIFIERS = [
  [ALT, 'alt'],
  [CONTROL, 'control'],
  [META, 'meta'],
  [SHIFT, 'shift'],
];
// [key, code, keyCode, text, Electron's name for the key]
const NAMED_KEYS = {
  enter: ['Enter', 'Enter', 13, '\r', 'Enter'],
  tab: ['Tab', 'Tab', 9, undefined, 'Tab'],
  escape: ['Escape', 'Escape', 27, undefined, 'Escape'],
  esc: ['Escape', 'Escape', 27, undefined, 'Escape'],
  backspace: ['Backspace', 'Backspace', 8, undefined, 'Backspace'],
  delete: ['Delete', 'Delete', 46, undefined, 'Delete'],
  space: [' ', 'Space', 32, ' ', 'Space'],
  arrowup: ['ArrowUp', 'ArrowUp', 38, undefined, 'Up'],
  arrowdown: ['ArrowDown', 'ArrowDown', 40, undefined, 'Down'],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37, undefined, 'Left'],
  arrowright: ['ArrowRight', 'ArrowRight', 39, undefined, 'Right'],
  home: ['Home', 'Home', 36, undefined, 'Home'],
  end: ['End', 'End', 35, undefined, 'End'],
  pageup: ['PageUp', 'PageUp', 33, undefined, 'PageUp'],
  pagedown: ['PageDown', 'PageDown', 34, undefined, 'PageDown'],
};
// What Shift makes of each digit and symbol key on a US keyboard, in pairs.
const SHIFTED = '1!2@3#4$5%6^7&8*9(0)-_=+[{]}\\|;:\'",<.>/?`~';
// On macOS a Meta chord edits only when Chromium is given the command.
const MAC_COMMANDS = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo' };
// Electron runs before-input-event inside sendInputEvent, so the app's
// shortcut forwarding can tell these keys from the user's.
const sendingAgentKeys = new WeakSet();

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
  let electronKey;
  if (named) {
    [key, code, keyCode, text, electronKey] = named;
  } else if (name.length === 1) {
    const upper = name.toUpperCase();
    // At an even place is a plain key; after it, what Shift makes of it.
    const plain = SHIFTED.indexOf(name);
    const shifted = plain % 2 === 0 ? SHIFTED[plain + 1] : upper;
    key = modifiers & SHIFT ? shifted : name;
    code = /[a-z]/i.test(name) ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : undefined;
    // A symbol's character code is another key's code ("%" is ArrowLeft's).
    keyCode = code ? upper.charCodeAt(0) : 0;
    text = key;
    electronKey = name;
  } else {
    throw new Error(
      `Unknown key "${name}"; use one character or a name such as Enter, Tab or ArrowDown.`,
    );
  }
  // A chord with Control or Meta is a shortcut, not text.
  if (modifiers & (CONTROL | META)) text = undefined;
  // Only the exact shortcut edits: Meta and the key, or Meta+Shift+Z for redo.
  let command;
  if (process.platform === 'darwin') {
    const lower = name.toLowerCase();
    if (modifiers === META) command = MAC_COMMANDS[lower];
    else if (modifiers === (META | SHIFT) && lower === 'z') command = 'redo';
  }
  return { key, code, windowsVirtualKeyCode: keyCode, modifiers, text, command, electronKey };
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

function createBrowserKeys({ clipboard }) {
  // The key is released only while `held()` says the page that took the press
  // is still there: a press that navigates leaves nothing to release.
  async function pressOn(contents, dbg, sessionId, key, held = async () => true) {
    if (sessionId) {
      await pressInFrame(dbg, sessionId, key, held);
      return;
    }
    // Electron's key events carry no command, so the page runs it, as the key would.
    if (key.command === 'paste') {
      await contents.insertText(clipboard.readText());
      return;
    }
    if (key.command) {
      await dbg.sendCommand('Runtime.evaluate', {
        expression: `(${RUN_COMMAND})(${JSON.stringify(key.command)})`,
        userGesture: true,
      });
      return;
    }
    const event = {
      keyCode: key.electronKey,
      modifiers: ELECTRON_MODIFIERS.filter(([bit]) => key.modifiers & bit).map(([, name]) => name),
    };
    sendAgentKey(contents, { ...event, type: 'keyDown' });
    if (key.text) sendAgentKey(contents, { ...event, type: 'char', keyCode: key.text });
    if (await held()) sendAgentKey(contents, { ...event, type: 'keyUp' });
  }

  // Electron's insertText reaches only the top document: with a cross-site
  // frame focused it crashes the page.
  async function insertTextOn(contents, dbg, sessionId, text) {
    if (sessionId) await send(dbg, sessionId, 'Input.insertText', { text });
    else await contents.insertText(text);
  }

  return { pressOn, insertTextOn };
}

async function pressInFrame(dbg, sessionId, key, held) {
  const { text, command } = key;
  const base = {
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    modifiers: key.modifiers,
  };
  await send(dbg, sessionId, 'Input.dispatchKeyEvent', {
    ...base,
    type: text ? 'keyDown' : 'rawKeyDown',
    text,
    unmodifiedText: text,
    commands: command ? [command] : undefined,
  });
  if (await held())
    await send(dbg, sessionId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

function sendAgentKey(contents, event) {
  sendingAgentKeys.add(contents);
  try {
    contents.sendInputEvent(event);
  } finally {
    sendingAgentKeys.delete(contents);
  }
}

function isAgentKey(contents) {
  return sendingAgentKeys.has(contents);
}

// An editing command on the document that has the focus, which can be a
// same-process frame inside the top one.
const RUN_COMMAND = `(command) => {
  let doc = document;
  while (doc.activeElement?.contentDocument) doc = doc.activeElement.contentDocument;
  doc.execCommand(command);
}`;

module.exports = { keyOf, modifiersOf, createBrowserKeys, isAgentKey };
