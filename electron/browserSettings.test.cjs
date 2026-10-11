const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBrowserSettingsController } = require('./browserSettings.cjs');
const { createBrowserPromptController } = require('./browserPrompt.cjs');

async function fixture(t, overrides = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'droidex-browser-settings-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const prompts = [];
  const responses = [];
  const options = {
    userDataPath,
    downloadsPath: path.join(userDataPath, 'Downloads'),
    showPrompt: async (prompt) => {
      prompts.push(prompt);
      return { response: responses.shift() ?? prompt.cancelId };
    },
    ...overrides,
  };
  const controller = createBrowserSettingsController(options);
  await controller.initialize();
  return { controller, options, prompts, responses };
}

test('browser policies default safely and persist across restarts', async (t) => {
  const { controller, options } = await fixture(t);
  const snapshot = controller.snapshot();
  assert.equal(snapshot.navigationApproval, 'follow_autonomy');
  assert.equal(snapshot.loginFillApproval, 'always_ask');
  assert.equal(snapshot.sitePermissionMode, 'block');
  assert.equal(snapshot.diagnosticsEnabled, false);
  assert.equal(snapshot.askDownloadLocation, true);
  assert.equal(snapshot.showAgentCursor, true);
  assert.equal(snapshot.homePage, 'https://www.google.com/');
  await controller.update({ showAgentCursor: false, agentAccessEnabled: false });
  const restarted = createBrowserSettingsController(options);
  await restarted.initialize();
  assert.equal(restarted.snapshot().showAgentCursor, false);
  assert.throws(() => restarted.assertAgentAccess(), /Agent browser access is off/);
  const saved = JSON.parse(await fs.readFile(controller.settingsPath, 'utf8'));
  assert.equal(saved.version, 5);
  assert.equal(saved.agentAccessEnabled, false);
  assert.equal((await fs.stat(controller.settingsPath)).mode & 0o777, 0o600);
});

test('each protection-reducing setting requires explicit approval', async (t) => {
  const { controller, prompts, responses } = await fixture(t);
  await controller.update({ agentAccessEnabled: false, loginFillApproval: 'never' });
  for (const patch of [
    { agentAccessEnabled: true },
    { diagnosticsEnabled: true },
    { loginFillApproval: 'always_ask' },
    { sitePermissionMode: 'ask' },
    { askDownloadLocation: false },
  ]) {
    const before = controller.snapshot();
    assert.deepEqual(await controller.update(patch), before);
    assert.equal(prompts.at(-1).defaultId, 1);
    assert.equal(prompts.at(-1).cancelId, 1);
    responses.push(0);
    assert.deepEqual(await controller.update(patch), { ...before, ...patch });
  }
  assert.equal(prompts.length, 10);
});

test('each navigation approval reduction requires confirmation', async (t) => {
  const { controller, prompts, responses } = await fixture(t);
  let snapshot = await controller.update({ navigationApproval: 'new_sites' });
  assert.equal(snapshot.navigationApproval, 'follow_autonomy');
  await controller.update({ navigationApproval: 'always_ask' });
  for (const navigationApproval of ['new_sites', 'follow_autonomy', 'never_ask']) {
    snapshot = await controller.update({ navigationApproval });
    assert.equal(snapshot.navigationApproval, 'always_ask');
  }
  responses.push(0);
  snapshot = await controller.update({ navigationApproval: 'new_sites' });
  assert.equal(snapshot.navigationApproval, 'new_sites');
  snapshot = await controller.update({ navigationApproval: 'follow_autonomy' });
  assert.equal(snapshot.navigationApproval, 'new_sites');
  assert.equal(prompts.length, 6);
});

test('concurrent updates cannot bypass confirmation of a queued protection increase', async (t) => {
  const { controller, prompts } = await fixture(t);
  const disabling = controller.update({ agentAccessEnabled: false });
  const enabling = controller.update({ agentAccessEnabled: true });
  await Promise.all([disabling, enabling]);
  assert.equal(controller.snapshot().agentAccessEnabled, false);
  assert.equal(prompts.length, 1);
});

test('invalid patches and persisted settings fail without replacing the settings file', async (t) => {
  const { controller, options } = await fixture(t);
  await controller.update({ showAgentCursor: false });
  const saved = await fs.readFile(controller.settingsPath, 'utf8');
  for (const patch of [
    { agentAccessEnabled: 'true' },
    { navigationApproval: 'sometimes' },
    { homePage: 'https://user:password@example.test/' },
    { homePage: 'file:///tmp/page' },
    { agentCursorSize: 52 },
    { approvedAgentOrigins: ['https://example.test'] },
  ]) {
    assert.throws(() => controller.update(patch));
  }
  assert.equal(await fs.readFile(controller.settingsPath, 'utf8'), saved);
  for (const contents of [
    '{',
    JSON.stringify({ ...JSON.parse(saved), version: 3 }),
    JSON.stringify({ ...JSON.parse(saved), approvedAgentOrigins: ['https://example.test/path'] }),
    JSON.stringify({ ...JSON.parse(saved), sitePermissions: [{ origin: 'https://example.test' }] }),
    JSON.stringify({ ...JSON.parse(saved), lastCookieImport: { cookies: ['secret'] } }),
  ]) {
    await fs.writeFile(controller.settingsPath, contents);
    await assert.rejects(createBrowserSettingsController(options).initialize());
    assert.equal(await fs.readFile(controller.settingsPath, 'utf8'), contents);
  }
});

test('a failed settings write leaves the active policy intact and later writes can succeed', async (t) => {
  const { controller } = await fixture(t);
  t.mock.method(fs, 'writeFile', async () => {
    throw new Error('disk unavailable');
  });
  await assert.rejects(controller.update({ agentAccessEnabled: false }), /disk unavailable/);
  controller.assertAgentAccess();
  t.mock.restoreAll();
  await controller.update({ agentAccessEnabled: false });
  assert.throws(() => controller.assertAgentAccess(), /Agent browser access is off/);
});

test('renderer teardown cancels active and queued settings changes without native prompts or writes', async (t) => {
  const shown = Promise.withResolvers();
  let nativePrompts = 0;
  const prompts = createBrowserPromptController({
    isAvailable: () => true,
    send: shown.resolve,
    showNative: async () => {
      nativePrompts++;
      return { response: 0 };
    },
  });
  t.after(() => prompts.cancelAll());
  prompts.setRendererReady(true);
  const { controller } = await fixture(t, { showPrompt: prompts.request });
  await controller.update({ showAgentCursor: true });
  const saved = await fs.readFile(controller.settingsPath, 'utf8');
  const updates = [
    controller.update({ diagnosticsEnabled: true }),
    controller.update({ navigationApproval: 'never_ask' }),
    controller.update({ showAgentCursor: false }),
  ];
  const cancelled = updates.map((update) => assert.rejects(update, /renderer closed/));
  await shown.promise;
  controller.cancelPendingUpdates();
  prompts.setRendererReady(false);
  await Promise.all(cancelled);

  assert.equal(nativePrompts, 0);
  assert.equal(controller.snapshot().diagnosticsEnabled, false);
  assert.equal(controller.snapshot().showAgentCursor, true);
  assert.equal(await fs.readFile(controller.settingsPath, 'utf8'), saved);
  await controller.update({ showAgentCursor: false });
  assert.equal(controller.snapshot().showAgentCursor, false);
});

test('protection confirmation names every reduced setting and its previous and requested values', async (t) => {
  const { controller, prompts } = await fixture(t);
  await controller.update({
    agentAccessEnabled: false,
    loginFillApproval: 'never',
    navigationApproval: 'always_ask',
  });
  const before = controller.snapshot();
  assert.deepEqual(
    await controller.update({
      agentAccessEnabled: true,
      diagnosticsEnabled: true,
      navigationApproval: 'never_ask',
      loginFillApproval: 'always_ask',
      sitePermissionMode: 'ask',
      askDownloadLocation: false,
      showAgentCursor: false,
    }),
    before,
  );
  assert.deepEqual(prompts[0].detail.split('\n\n')[0].split('\n'), [
    'Agent browser access: Off → On',
    'Agent browser diagnostics: Off → On',
    'Website opening approval: Always ask → Full site access',
    'Agent login fill: Never use → Always ask',
    'Camera and microphone: Block → Ask me',
    'Ask where to save downloads: On → Off',
  ]);
  assert.equal(prompts.length, 1);
});
