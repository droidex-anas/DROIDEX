const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeBrowserShortcuts } = require('./nativeBrowserShortcuts.cjs');

const NEW_TAB = { meta: true, control: false, alt: false, shift: false, code: 'KeyT', key: 'T' };
const NAMED_KEY = { meta: true, control: false, alt: false, shift: false, code: null, key: 'F3' };

function setup() {
  const sent = [];
  const focused = [];
  const mainWindow = {
    isDestroyed: () => false,
    webContents: {
      focus: () => focused.push(true),
      send: (channel, payload) => sent.push({ channel, payload }),
    },
  };
  const shortcuts = createNativeBrowserShortcuts({ getMainWindow: () => mainWindow });
  const press = (input) => {
    let prevented = false;
    shortcuts.handleInput(
      { preventDefault: () => (prevented = true) },
      {
        type: 'keyDown',
        meta: false,
        control: false,
        alt: false,
        shift: false,
        isAutoRepeat: false,
        ...input,
      },
    );
    return prevented;
  };
  return { shortcuts, press, sent, focused };
}

test('an app chord pressed in a browser page goes to the app instead of the page', () => {
  const { shortcuts, press, sent, focused } = setup();
  shortcuts.setChords([NEW_TAB, NAMED_KEY]);

  assert.equal(press({ meta: true, code: 'KeyT', key: 't' }), true);
  assert.equal(press({ meta: true, code: 'F3', key: 'F3' }), true);

  assert.equal(focused.length, 2);
  assert.deepEqual(sent[0], {
    channel: 'native-browser-shortcut',
    payload: {
      key: 't',
      code: 'KeyT',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
    },
  });
});

test('other key presses, key releases and malformed chords stay with the page', () => {
  const { shortcuts, press, sent } = setup();
  shortcuts.setChords([NEW_TAB, { ...NEW_TAB, code: 'KeyW', meta: 'yes' }, null]);

  assert.equal(press({ meta: true, shift: true, code: 'KeyT', key: 'T' }), false);
  assert.equal(press({ code: 'KeyT', key: 't' }), false);
  assert.equal(press({ meta: true, code: 'KeyW', key: 'w' }), false);
  assert.equal(press({ type: 'keyUp', meta: true, code: 'KeyT', key: 't' }), false);
  assert.equal(sent.length, 0);

  shortcuts.setChords('not a list');
  assert.equal(press({ meta: true, code: 'KeyT', key: 't' }), false);
});
