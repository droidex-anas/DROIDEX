const test = require('node:test');
const assert = require('node:assert/strict');
const { keyOf, createBrowserKeys, isAgentKey } = require('./browserKeys.cjs');

function setup() {
  const cdp = [];
  const input = [];
  const dbg = {
    sendCommand: async (method, params, sessionId) => cdp.push({ method, params, sessionId }),
  };
  const contents = {
    sendInputEvent: (event) => input.push({ ...event, agent: isAgentKey(contents) }),
    insertText: async (text) => input.push({ type: 'insertText', text }),
  };
  const keys = createBrowserKeys({ clipboard: { readText: () => 'copied' } });
  return { keys, dbg, contents, cdp, input };
}

// CDP input for the top document follows the app's keyboard focus, so it would
// type into the user's composer instead of the page.
test('keys and text for the top document go to the page, never through CDP', async () => {
  const { keys, dbg, contents, cdp, input } = setup();

  await keys.pressOn(contents, dbg, undefined, keyOf('Shift+a'));
  await keys.insertTextOn(contents, dbg, undefined, 'hello');

  assert.deepEqual(cdp, []);
  assert.deepEqual(input, [
    { type: 'keyDown', keyCode: 'a', modifiers: ['shift'], agent: true },
    { type: 'char', keyCode: 'A', modifiers: ['shift'], agent: true },
    { type: 'keyUp', keyCode: 'a', modifiers: ['shift'], agent: true },
    { type: 'insertText', text: 'hello' },
  ]);
  assert.equal(isAgentKey(contents), false);
});

test('a press that navigates away is not released', async () => {
  const { keys, dbg, contents, input } = setup();

  await keys.pressOn(contents, dbg, undefined, keyOf('Enter'), async () => false);

  assert.deepEqual(
    input.map((event) => event.type),
    ['keyDown', 'char'],
  );
});

test('a cross-site frame takes keys and text on its own CDP session', async () => {
  const { keys, dbg, contents, cdp, input } = setup();

  await keys.pressOn(contents, dbg, 'frame-1', keyOf('Tab'));
  await keys.insertTextOn(contents, dbg, 'frame-1', 'hi');

  assert.deepEqual(input, []);
  assert.deepEqual(
    cdp.map(({ method, params, sessionId }) => [method, params.type ?? params.text, sessionId]),
    [
      ['Input.dispatchKeyEvent', 'rawKeyDown', 'frame-1'],
      ['Input.dispatchKeyEvent', 'keyUp', 'frame-1'],
      ['Input.insertText', 'hi', 'frame-1'],
    ],
  );
});
