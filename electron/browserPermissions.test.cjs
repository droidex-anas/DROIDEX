const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserPermissionController } = require('./browserPermissions.cjs');

function fixture(overrides = {}) {
  const contents = {
    url: 'https://site.test/page',
    destroyed: false,
    working: false,
    getURL() {
      return this.url;
    },
    isDestroyed() {
      return this.destroyed;
    },
  };
  const frame = {
    url: contents.url,
    origin: 'https://site.test',
    processId: 1,
    routingId: 1,
    detached: false,
    isDestroyed: () => false,
  };
  frame.framesInSubtree = [frame];
  contents.mainFrame = frame;
  const decisions = new Map();
  const prompts = [];
  const writes = [];
  const responses = [];
  const controller = createBrowserPermissionController({
    platform: 'darwin',
    isNativeBrowserContents: (candidate) => candidate === contents,
    listContents: () => [contents],
    isWorking: (page) => page.working,
    getSiteDecision: (origin, permission) => decisions.get(`${origin}/${permission}`) ?? 'ask',
    persistSiteDecision: async (input, signal) => {
      signal.throwIfAborted();
      writes.push(input);
      for (const permission of input.permissions)
        decisions.set(`${input.origin}/${permission}`, input.decision);
    },
    showPrompt: async (prompt) => {
      prompts.push(prompt);
      return responses.shift() ?? { response: 2 };
    },
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    ...overrides,
  });
  const request = (permission = 'media', details = {}) =>
    new Promise((resolve) => {
      controller.handleRequest(contents, permission, resolve, {
        requestingUrl: contents.url,
        isMainFrame: true,
        mediaTypes: ['video'],
        ...details,
      });
    });
  const check = (permission = 'media', details = {}) =>
    controller.canAccess(contents, permission, 'https://site.test', {
      requestingUrl: contents.url,
      mediaType: 'video',
      isMainFrame: true,
      ...details,
    });
  return { controller, contents, decisions, prompts, writes, responses, request, check };
}

test('checks fail closed for unapproved access, unknown permissions, media and foreign contents', async () => {
  const { controller, contents, prompts, request, check } = fixture();
  assert.equal(check(), false);
  for (const permission of ['hid', 'usb', 'serial', 'display-capture', 'unknown', 'camera']) {
    assert.equal(await request(permission), false);
    assert.equal(check(permission), false);
  }
  for (const mediaTypes of [undefined, [], ['unknown'], ['video', 'unknown']])
    assert.equal(await request('media', { mediaTypes }), false);
  assert.equal(await request('media', { requestingUrl: 'file:///tmp/page' }), false);
  assert.equal(controller.canAccess(null, 'media', 'https://site.test'), false);
  const foreign = { ...contents };
  assert.equal(
    await new Promise((resolve) =>
      controller.handleRequest(foreign, 'media', resolve, {
        requestingUrl: foreign.url,
        mediaTypes: ['video'],
      }),
    ),
    false,
  );
  assert.equal(prompts.length, 0);
});

test('allow once grants only requested media on the exact origin until navigation', async () => {
  const { controller, contents, responses, request, check, prompts, writes } = fixture();
  const embedded = { ...contents.mainFrame, url: 'https://site.test/embedded', routingId: 2 };
  contents.mainFrame.framesInSubtree.push(embedded);
  responses.push({ response: 1 });
  assert.equal(
    await request('media', {
      requestingUrl: 'https://site.test/embedded',
      isMainFrame: false,
      mediaTypes: ['video', 'audio', 'video'],
    }),
    true,
  );
  assert.match(prompts[0].message, /^https:\/\/site.test wants to use your camera and microphone/);
  const details = { requestingUrl: embedded.url, isMainFrame: false };
  assert.equal(check('media', details), true);
  assert.equal(check('media', { ...details, mediaType: 'audio' }), true);
  assert.equal(check('media', { requestingUrl: 'https://other.test/frame' }), false);
  assert.equal(check('geolocation'), false);
  assert.deepEqual(writes, []);
  controller.revokeForContents(contents);
  assert.equal(check(), false);
});

test('remembered grants are per permission and media denial wins a mixed request', async () => {
  const { controller, contents, decisions, responses, request, check, prompts } = fixture();
  for (const permission of [
    'geolocation',
    'notifications',
    'clipboard-read',
    'midi',
    'midiSysex',
  ]) {
    responses.push({ response: 0 });
    assert.equal(await request(permission), true);
    controller.revokeForContents(contents);
    assert.equal(check(permission), true);
    assert.equal(await request(permission), true);
  }
  assert.equal(prompts.length, 5);
  decisions.set('https://site.test/camera', 'allow');
  decisions.set('https://site.test/microphone', 'deny');
  assert.equal(await request('media', { mediaTypes: ['video', 'audio'] }), false);
  assert.equal(check(), true);
  assert.equal(check('media', { mediaType: 'audio' }), false);
  assert.equal(prompts.length, 5);
});

test('a cross-origin frame cannot borrow the top page grant or spoof the requesting URL', async () => {
  const { decisions, request, check, prompts } = fixture();
  decisions.set('https://site.test/camera', 'allow');
  decisions.set('https://embedded.test/camera', 'allow');
  const details = {
    requestingUrl: 'https://embedded.test/frame',
    securityOrigin: 'https://site.test',
    isMainFrame: false,
  };
  assert.equal(await request('media', details), false);
  assert.equal(check('media', details), false);
  assert.equal(
    await request('media', { requestingUrl: undefined, securityOrigin: 'https://site.test' }),
    false,
  );
  assert.equal(prompts.length, 0);
});

test('opaque or missing security origins cannot borrow grants from an HTTPS frame URL', async () => {
  const { controller, contents, decisions, request, prompts } = fixture();
  const frame = { ...contents.mainFrame, routingId: 2, origin: 'null' };
  contents.mainFrame.framesInSubtree.push(frame);
  const details = { requestingUrl: frame.url, isMainFrame: false };
  for (const permission of ['geolocation', 'midi', 'clipboard-read']) {
    decisions.set(`https://site.test/${permission}`, 'allow');
    assert.equal(await request(permission, details), false);
    for (const origin of ['null', '', undefined, 'https://other.test']) {
      assert.equal(controller.canAccess(contents, permission, origin, details), false);
    }
    // Even a non-opaque handler origin cannot authorize an opaque live frame.
    assert.equal(controller.canAccess(contents, permission, 'https://site.test', details), false);
  }
  frame.origin = undefined;
  assert.equal(await request('geolocation', details), false);
  frame.origin = 'https://site.test';
  for (const origin of ['null', '', undefined, 'https://other.test']) {
    assert.equal(controller.canAccess(contents, 'geolocation', origin, details), false);
  }
  assert.equal(await request('geolocation', { ...details, securityOrigin: 'null' }), false);
  assert.equal(await request('geolocation', details), true);
  assert.deepEqual(prompts, []);
});

test('cancellation and one-time denial are not remembered; always block is explicit', async () => {
  const { responses, request, writes, check } = fixture();
  for (const answer of [
    { response: 2 },
    { response: 2, cancelled: true },
    { response: 0, cancelled: true },
  ]) {
    responses.push(answer);
    assert.equal(await request(), false);
    assert.equal(check(), false);
  }
  assert.deepEqual(writes, []);
  responses.push({ response: 1 });
  assert.equal(await request(), true);
  responses.push({ response: 3 });
  assert.equal(await request('media', { mediaTypes: ['audio'] }), false);
  assert.deepEqual(writes, [
    { origin: 'https://site.test', permissions: ['microphone'], decision: 'deny' },
  ]);
});

test('navigation cancels the callback immediately and late approvals cannot grant a replacement page', async () => {
  const answer = Promise.withResolvers();
  let signal;
  const { controller, contents, request, check, writes } = fixture({
    showPrompt: (_prompt, options) => {
      signal = options.signal;
      return answer.promise;
    },
  });
  const pending = request();
  assert.equal(await request('geolocation'), false);
  controller.revokeForContents(contents);
  assert.equal(await pending, false);
  assert.equal(signal.aborted, true);
  contents.url = 'https://site.test/replacement';
  answer.resolve({ response: 0 });
  await Promise.resolve();
  assert.equal(check(), false);
  assert.deepEqual(writes, []);
  contents.destroyed = true;
  assert.equal(await request(), false);
});

test('revocation clears temporary access and blocks new approval until its write settles', async () => {
  const write = Promise.withResolvers();
  const { controller, responses, request, check } = fixture({
    persistSiteDecision: async () => {
      await write.promise;
    },
  });
  responses.push({ response: 1 });
  assert.equal(await request(), true);
  assert.equal(check(), true);
  const revoked = controller.revokeSitePermission('https://site.test', 'camera');
  assert.equal(check(), false);
  assert.equal(await request(), false);
  responses.push({ response: 1 });
  assert.equal(await request('geolocation'), true);
  write.resolve();
  await revoked;
  assert.equal(check(), false);
  const prompt = Promise.withResolvers();
  const pending = fixture({ showPrompt: () => prompt.promise });
  const requested = pending.request();
  await pending.controller.revokeSitePermission('https://site.test', 'camera');
  assert.equal(await requested, false);
  prompt.resolve({ response: 0 });
  await Promise.resolve();
  assert.deepEqual(pending.writes, [
    { origin: 'https://site.test', permissions: ['camera'], decision: 'ask' },
  ]);
});

test('saved origin decisions apply during agent work; an unsaved decision still waits for the user', async () => {
  const answer = Promise.withResolvers();
  const prompts = [];
  const { contents, decisions, request, check } = fixture({
    showPrompt: (prompt) => {
      prompts.push(prompt);
      return answer.promise;
    },
  });
  decisions.set('https://site.test/camera', 'allow');
  contents.working = true;
  assert.equal(check(), true);
  assert.equal(await request(), true);
  assert.deepEqual(prompts, []);
  const pending = request('geolocation');
  assert.equal(check('geolocation'), false);
  assert.match(prompts[0].detail, /An agent is working on this page\./);
  contents.working = false;
  assert.equal(check(), true);
  assert.equal(check('geolocation'), false);
  answer.resolve({ response: 0 });
  assert.equal(await pending, true);
  assert.equal(check('geolocation'), true);
});

test('notification checks without contents require prior origin approval and valid embedding', async () => {
  const { controller, responses, request } = fixture();
  const check = (embeddingOrigin = 'https://site.test') =>
    controller.canAccess(null, 'notifications', 'https://site.test', { embeddingOrigin });
  assert.equal(check(), false);
  responses.push({ response: 0 });
  assert.equal(await request('notifications'), true);
  assert.equal(check(), true);
  assert.equal(check('https://other.test'), false);
  assert.equal(check(''), false);
  assert.equal(check('null'), false);
  assert.equal(controller.canAccess(null, 'notifications', 'https://site.test'), false);
});

test('macOS must approve each requested media device before a site grant is saved', async () => {
  const statuses = new Map();
  const asked = [];
  const { responses, request, check, writes } = fixture({
    systemPreferences: {
      getMediaAccessStatus: (permission) => statuses.get(permission) ?? 'not-determined',
      askForMediaAccess: async (permission) => {
        asked.push(permission);
        statuses.set(permission, 'granted');
        return true;
      },
    },
  });
  responses.push({ response: 0 });
  assert.equal(await request('media', { mediaTypes: ['audio', 'video'] }), true);
  assert.deepEqual(asked, ['microphone', 'camera']);
  assert.equal(writes.length, 1);
  statuses.set('camera', 'denied');
  assert.equal(check(), false);
});

test('macOS denial explains recovery and never persists the requested grant', async () => {
  const opened = [];
  let status = 'not-determined';
  const { responses, request, prompts, writes } = fixture({
    systemPreferences: {
      getMediaAccessStatus: () => status,
      askForMediaAccess: async () => {
        status = 'denied';
        return false;
      },
    },
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  responses.push({ response: 0 }, { response: 0 });
  assert.equal(await request(), false);
  assert.match(prompts[1].title, /macOS blocked camera/);
  assert.match(prompts[1].detail, /restart DROIDEX/);
  assert.deepEqual(opened, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  ]);
  assert.deepEqual(writes, []);
});

test('closing during macOS consent denies immediately and cannot save a late grant', async () => {
  const asked = Promise.withResolvers();
  const consent = Promise.withResolvers();
  const { controller, contents, responses, request, writes } = fixture({
    systemPreferences: {
      getMediaAccessStatus: () => 'not-determined',
      askForMediaAccess: () => {
        asked.resolve();
        return consent.promise;
      },
    },
  });
  responses.push({ response: 0 });
  const pending = request();
  await asked.promise;
  controller.revokeForContents(contents);
  assert.equal(await pending, false);
  consent.resolve(true);
  await Promise.resolve();
  assert.deepEqual(writes, []);
});

test('macOS consent times out without caching a denial or accepting a late answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const asked = Promise.withResolvers();
  const consent = Promise.withResolvers();
  const { responses, request, writes } = fixture({
    systemPreferences: {
      getMediaAccessStatus: () => 'not-determined',
      askForMediaAccess: () => {
        asked.resolve();
        return consent.promise;
      },
    },
  });
  responses.push({ response: 0 });
  const pending = request();
  await asked.promise;
  t.mock.timers.tick(120_000);
  assert.equal(await pending, false);
  consent.resolve(true);
  await Promise.resolve();
  assert.deepEqual(writes, []);
  responses.push({ response: 1 });
  assert.equal(await request('geolocation'), true);
});

test('persistence failure denies without retaining a temporary grant', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { responses, request, check } = fixture({
    persistSiteDecision: async () => {
      throw new Error('disk full');
    },
  });
  responses.push({ response: 0 });
  assert.equal(await request(), false);
  assert.equal(check(), false);
});
