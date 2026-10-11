const assert = require('node:assert/strict');
const test = require('node:test');
const { createNativeBrowserPage } = require('./nativeBrowserPage.cjs');

test('turning the cursor off suppresses all subsequent renderer points and retains click kinds when enabled', () => {
  const settings = { showAgentCursor: true };
  const events = [];
  const page = createNativeBrowserPage({
    credentials: {},
    getSettings: () => settings,
    sendToRenderer: (channel, payload) => events.push({ channel, ...payload }),
  });
  const entry = { browserSessionId: 'browser' };
  page.sendAgentPoint(entry, { x: 10, y: 20, kind: 'click' });
  settings.showAgentCursor = false;
  for (const kind of ['move', 'click', 'scroll'])
    page.sendAgentPoint(entry, { x: 30, y: 40, kind });
  assert.deepEqual(events, [
    {
      channel: 'native-browser-agent-point',
      browserSessionId: 'browser',
      x: 10,
      y: 20,
      kind: 'click',
    },
  ]);
});
