const path = require('node:path');
const {
  createDefaultBrowserSettings,
  readSettings,
  validateSettings,
  validateSettingsPatch,
  weakensBrowserProtection,
  writeSettings,
} = require('./browserSettingsSchema.cjs');

function createBrowserSettingsController({ userDataPath, downloadsPath, showPrompt }) {
  const settingsPath = path.join(userDataPath, 'browser-settings.json');
  let settings;
  let writes = Promise.resolve();

  async function initialize() {
    settings = await readSettings(settingsPath, createDefaultBrowserSettings(downloadsPath));
  }

  function requireSettings() {
    if (!settings) throw new Error('Browser settings are not initialized.');
    return settings;
  }

  function snapshot() {
    const current = requireSettings();
    return {
      agentAccessEnabled: current.agentAccessEnabled,
      navigationApproval: current.navigationApproval,
      loginFillApproval: current.loginFillApproval,
      diagnosticsEnabled: current.diagnosticsEnabled,
      sitePermissionMode: current.sitePermissionMode,
      askDownloadLocation: current.askDownloadLocation,
      showAgentCursor: current.showAgentCursor,
      homePage: current.homePage,
      downloadDirectoryLabel:
        current.downloadDirectory === downloadsPath
          ? 'System Downloads folder'
          : 'Custom download folder',
      approvedAgentOrigins: [...current.approvedAgentOrigins].sort(),
      sitePermissionRules: current.sitePermissions
        .map((rule) => ({ ...rule }))
        .sort((left, right) => left.origin.localeCompare(right.origin)),
      lastCookieImport: current.lastCookieImport ? { ...current.lastCookieImport } : null,
    };
  }

  function update(patch) {
    const validatedPatch = validateSettingsPatch(patch);
    // Check protection against the state this write replaces, including earlier queued writes.
    const run = writes.then(async () => {
      const current = requireSettings();
      if (weakensBrowserProtection(current, validatedPatch)) {
        const { response } = await showPrompt({
          kind: 'warning',
          buttons: ['Apply change', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Reduce DROIDEX Browser protection?',
          message: 'This change gives agents or websites more browser access.',
          detail: 'Only apply this change if you trust the agents and websites using the browser.',
        });
        if (response !== 0) return snapshot();
      }
      const next = validateSettings(
        { ...current, ...validatedPatch },
        createDefaultBrowserSettings(downloadsPath),
      );
      await writeSettings(settingsPath, next);
      settings = next;
      return snapshot();
    });
    writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function assertAgentAccess() {
    if (!requireSettings().agentAccessEnabled) {
      throw new Error('Agent browser access is off. Enable it in Settings > Browser.');
    }
  }

  return { settingsPath, initialize, snapshot, update, assertAgentAccess };
}

module.exports = { createBrowserSettingsController };
