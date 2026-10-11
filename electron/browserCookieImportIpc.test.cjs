const assert = require('node:assert/strict');
const test = require('node:test');
const { registerBrowserCookieImportIpc } = require('./browserCookieImportIpc.cjs');

test('every cookie import command rejects untrusted renderers before touching profiles or cookies', async () => {
  const handlers = new Map();
  const trusted = {};
  const calls = [];
  const imports = {};
  for (const name of [
    'discoverProfiles',
    'prepareProfile',
    'commitProfile',
    'discardProfile',
    'importFile',
  ]) {
    imports[name] = async (argument) => {
      calls.push({ name, argument });
      return 'result';
    };
  }
  registerBrowserCookieImportIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    imports,
    assertMainRenderer: (event) => {
      if (event !== trusted) throw new Error('unknown renderer');
    },
  });
  for (const handler of handlers.values()) {
    await assert.rejects(
      handler({}, { profileId: 'Default', planId: 'plan', filePath: '/fixture' }),
      /unknown renderer/,
    );
  }
  assert.deepEqual(calls, []);
  assert.equal(
    await handlers.get('browser-cookie-profile-import-prepare')(trusted, { profileId: 'Default' }),
    'result',
  );
  assert.deepEqual(calls, [{ name: 'prepareProfile', argument: 'Default' }]);
});
