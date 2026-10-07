const { callPageScript } = require('./browserPageScript.cjs');
const {
  createBrowserCredentialVault,
  secureCredentialOrigin,
} = require('./browserCredentialVault.cjs');
const { createCredentialCaptureGuard } = require('./browserCredentialCapture.cjs');
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
    const url = frame.url;
    try {
      secureCredentialOrigin(url);
    } catch {
      return;
    }
    const isCurrent = createCredentialCaptureGuard(entry, contents, url);
    await vault.capture({
      url,
      username: payload?.username,
      password: payload?.password,
      isStillValid: () => isCurrent() && getSettings().loginFillApproval !== 'never',
    });
  }

  async function fillForAgent(contents, entry, request) {
    const approval = browserApproval(contents, entry, request);
    const assertCurrent = () => {
      approval.assertCurrent();
      if (getSettings().loginFillApproval === 'never')
        throw new Error('Saved-login filling is off in Settings > Browser.');
    };
    try {
      assertCurrent();
      const origin = secureCredentialOrigin(contents.getURL());
      const documentId = await callPageScript(contents, '__droidexCredentialDocument');
      assertCurrent();
      const credential = await vault.credentialForAgent(origin, {
        assertCurrent,
        signal: approval.signal,
      });
      assertCurrent();
      const fill = await callPageScript(contents, '__droidexFillCredentials', {
        ...credential,
        origin,
        documentId,
        startBy: request.startBy,
      });
      assertCurrent();
      if (!fill?.ok)
        throw new Error(fill?.error || 'Could not find a login form to fill on this page.');
      entry.networkEvents.length = 0;
      entry.consoleEvents.length = 0;
    } finally {
      approval.dispose();
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

  return { handleCapture, fillForAgent, savedSecretsFor, list, deleteLogin };
}

module.exports = { createNativeBrowserCredentials };
