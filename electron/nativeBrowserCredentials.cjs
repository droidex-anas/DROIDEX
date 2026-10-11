const { callPageScript } = require('./browserPageScript.cjs');
const {
  createBrowserCredentialVault,
  secureCredentialOrigin,
} = require('./browserCredentialVault.cjs');
const { randomUUID } = require('node:crypto');
const { browserApproval } = require('./browserApproval.cjs');

function createNativeBrowserCredentials({
  app,
  appName,
  safeStorage,
  systemPreferences,
  showPrompt,
  getSettings,
  findEntry,
}) {
  const fills = new Map();
  const vault = createBrowserCredentialVault({
    userDataPath: app.getPath('userData'),
    appName,
    safeStorage,
    systemPreferences,
    platform: process.platform,
    showPrompt,
  });

  async function handleCapture(contents, frame, payload) {
    const entry = findEntry(contents);
    // Only the registered guest's main-frame preload captures. The page's
    // payload supplies values, never the site those values belong to.
    if (!entry || frame !== contents.mainFrame || getSettings().loginFillApproval === 'never')
      return;
    const origin = frame.origin;
    const documents = entry.documents;
    try {
      secureCredentialOrigin(origin);
    } catch {
      return;
    }
    await vault.capture({
      url: origin,
      username: payload?.username,
      password: payload?.password,
      isStillValid: () =>
        entry.contents === contents &&
        !contents.isDestroyed() &&
        entry.documents === documents &&
        contents.mainFrame === frame &&
        frame.origin === origin &&
        getSettings().loginFillApproval !== 'never',
    });
  }

  async function fillForAgent(contents, entry, request) {
    const frame = contents.mainFrame;
    const origin = secureCredentialOrigin(frame.origin);
    const approval = browserApproval(contents, entry, request);
    const token = randomUUID();
    const revoke = () => fills.delete(token);
    approval.signal.addEventListener('abort', revoke, { once: true });
    const assertCurrent = () => {
      approval.assertCurrent();
      if (contents.mainFrame !== frame || frame.origin !== origin)
        throw new Error('The page changed before the login was filled.');
      if (getSettings().loginFillApproval === 'never')
        throw new Error('Saved-login filling is off in Settings > Browser.');
    };
    try {
      assertCurrent();
      const documentId = await callPageScript(contents, '__droidexCredentialDocument');
      assertCurrent();
      const credential = await vault.credentialForAgent(origin, {
        assertCurrent,
        signal: approval.signal,
      });
      assertCurrent();
      fills.set(token, { contents, frame, assertCurrent });
      const secrets = secretsOn(entry, contents);
      for (const value of [credential.username, credential.password]) if (value) secrets.add(value);
      const fill = await callPageScript(contents, '__droidexFillCredentials', {
        ...credential,
        origin,
        documentId,
        token,
        startBy: request.startBy,
      });
      assertCurrent();
      if (!fill?.ok)
        throw new Error(fill?.error || 'Could not find a login form to fill on this page.');
    } finally {
      revoke();
      approval.signal.removeEventListener('abort', revoke);
      approval.dispose();
    }
  }

  function canFill(contents, frame, token) {
    const fill = fills.get(token);
    if (!fill || fill.contents !== contents || fill.frame !== frame) return false;
    try {
      fill.assertCurrent();
      return true;
    } catch {
      fills.delete(token);
      return false;
    }
  }

  async function savedSecretsFor(url) {
    let origin;
    try {
      origin = secureCredentialOrigin(url);
    } catch {
      return [];
    }
    const credential = await vault.read(origin);
    return credential ? [credential.username, credential.password] : [];
  }

  async function list() {
    return {
      origins: await vault.origins(),
      keychainAvailable: await vault.isAvailable(),
      touchIdAvailable: vault.touchIdAvailable(),
    };
  }

  async function deleteLogin(origin) {
    await vault.delete(origin);
    return list();
  }

  return { handleCapture, fillForAgent, canFill, savedSecretsFor, list, deleteLogin };
}

// A read keeps its document's set even if navigation finishes before it returns.
function secretsOn(entry, contents) {
  if (entry.credentialSecrets?.contents === contents) return entry.credentialSecrets.values;
  const values = new Set();
  entry.credentialSecrets = { contents, values };
  const clear = () => {
    contents.removeListener('did-navigate', clear);
    contents.removeListener('destroyed', clear);
    if (entry.credentialSecrets?.values !== values) return;
    entry.consoleEvents = redactSecrets(entry.consoleEvents, values);
    entry.networkEvents = redactSecrets(entry.networkEvents, values);
    delete entry.credentialSecrets;
  };
  contents.once('did-navigate', clear);
  contents.once('destroyed', clear);
  return values;
}

function redactSecrets(value, secrets) {
  if (!secrets.size) return value;
  if (typeof value === 'string') {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length))
      value = value.split(secret).join('[redacted]');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'image' || key === 'requestId' ? item : redactSecrets(item, secrets),
    ]),
  );
}

module.exports = { createNativeBrowserCredentials, secretsOn, redactSecrets };
