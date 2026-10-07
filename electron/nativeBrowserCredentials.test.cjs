const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createNativeBrowserCredentials } = require('./nativeBrowserCredentials.cjs');

async function fixture(t) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ac2-credentials-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const contents = Object.assign(new EventEmitter(), {
    url: 'https://accounts.example/login',
    getURL() {
      return this.url;
    },
    isDestroyed: () => false,
  });
  contents.mainFrame = {
    get url() {
      return contents.url;
    },
  };
  const entry = { contents, documents: 1, consoleEvents: [], networkEvents: [] };
  const settings = { loginFillApproval: 'always_ask' };
  const filled = [];
  const prompts = [];
  let answer = async () => ({ response: 0 });
  const page = {
    __droidexCredentialDocument: () => 'document-1',
    __droidexFillCredentials: (value) => {
      filled.push(value);
      return { ok: true };
    },
  };
  contents.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
    assert.equal(world, 999);
    return vm.runInNewContext(scripts[0].code, page);
  };
  const credentials = createNativeBrowserCredentials({
    app: { getPath: () => userData },
    appName: 'DROIDEX',
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    systemPreferences: { canPromptTouchID: () => false },
    showPrompt: async (prompt) => {
      prompts.push(prompt);
      return answer(prompt);
    },
    getSettings: () => settings,
    findEntry: (candidate) => (candidate === entry.contents ? entry : undefined),
  });
  const capture = (payload = {}) =>
    credentials.handleCapture(contents, contents.mainFrame, {
      username: 'account-name',
      password: 'saved-secret',
      ...payload,
    });
  const fill = () =>
    credentials.fillForAgent(contents, entry, {
      startBy: Date.now() + 10_000,
      runEnded: () => false,
      signal: new AbortController().signal,
    });
  return {
    credentials,
    contents,
    entry,
    settings,
    prompts,
    filled,
    capture,
    fill,
    answer: (fn) => {
      answer = fn;
    },
  };
}

test('capture trusts only the registered main frame and ignores payload origins', async (t) => {
  const f = await fixture(t);
  await f.credentials.handleCapture(
    f.contents,
    { url: 'https://attacker.example' },
    { username: 'u', password: 'p' },
  );
  assert.equal(f.prompts.length, 0);
  await f.capture({ origin: 'https://attacker.example', url: 'https://attacker.example' });
  const listed = await f.credentials.list();
  assert.deepEqual(listed.origins, ['https://accounts.example']);
  assert.equal(JSON.stringify(listed).includes('saved-secret'), false);
  assert.equal(JSON.stringify(listed).includes('account-name'), false);
  await f.credentials.deleteLogin('https://accounts.example');
  assert.deepEqual((await f.credentials.list()).origins, []);
});

test('capture survives same-origin login navigation but refuses a replaced guest or changed origin', async (t) => {
  const f = await fixture(t);
  f.answer(async () => {
    f.contents.url = 'https://accounts.example/dashboard';
    return { response: 0 };
  });
  await f.capture();
  assert.deepEqual((await f.credentials.list()).origins, ['https://accounts.example']);
  await f.credentials.deleteLogin('https://accounts.example');
  f.answer(async () => {
    f.contents.url = 'https://attacker.example';
    return { response: 0 };
  });
  await f.capture();
  assert.deepEqual((await f.credentials.list()).origins, []);
  f.contents.url = 'https://accounts.example/login';
  f.answer(async () => {
    f.entry.contents = {};
    return { response: 0 };
  });
  await f.capture();
  assert.deepEqual((await f.credentials.list()).origins, []);
});

test('insecure origins and the never policy cannot save or fill logins', async (t) => {
  const f = await fixture(t);
  f.contents.url = 'http://accounts.example/login';
  await f.capture();
  await assert.rejects(f.fill(), /HTTPS/);
  f.contents.url = 'https://accounts.example/login';
  f.settings.loginFillApproval = 'never';
  await f.capture();
  await assert.rejects(f.fill(), /off in Settings/);
  assert.equal(f.prompts.length, 0);
  assert.deepEqual(f.filled, []);
});

test('each fill asks again and sends the secret only to the isolated page script', async (t) => {
  const f = await fixture(t);
  await f.capture();
  assert.equal(await f.fill(), undefined);
  assert.equal(await f.fill(), undefined);
  assert.equal(f.prompts.filter((prompt) => prompt.title === 'Use saved login?').length, 2);
  assert.equal(f.filled.length, 2);
  assert.equal(f.filled[0].password, 'saved-secret');
  assert.equal(f.filled[0].documentId, 'document-1');
  assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
});

test('policy changes and same-URL document replacement revoke a pending saved-login approval', async (t) => {
  const f = await fixture(t);
  await f.capture();
  f.answer(async () => {
    f.entry.documents++;
    return { response: 0 };
  });
  await assert.rejects(f.fill(), /page changed/);
  f.answer(async () => {
    f.settings.loginFillApproval = 'never';
    return { response: 0 };
  });
  await assert.rejects(f.fill(), /off in Settings/);
  assert.deepEqual(f.filled, []);
});
