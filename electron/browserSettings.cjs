const path = require('node:path');
const {
  createDefaultBrowserSettings,
  readSettings,
  validateSettings,
  validateSettingsPatch,
  browserProtectionReductions,
  writeSettings,
  exactHttpOrigin,
  effectiveNavigationApproval,
} = require('./browserSettingsSchema.cjs');

function createBrowserSettingsController({ userDataPath, downloadsPath, showPrompt }) {
  const settingsPath = path.join(userDataPath, 'browser-settings.json');
  let settings;
  const approvedOrigins = new Set();
  let writes = Promise.resolve();
  let pendingUpdates = new AbortController();

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
      approvedAgentOrigins: [...approvedOrigins].sort(),
      sitePermissionRules: current.sitePermissions
        .map((rule) => ({ ...rule }))
        .sort((left, right) => left.origin.localeCompare(right.origin)),
    };
  }

  function update(patch) {
    const validatedPatch = validateSettingsPatch(patch);
    const { signal } = pendingUpdates;
    // Check protection against the state this write replaces, including earlier queued writes.
    const run = writes.then(async () => {
      signal.throwIfAborted();
      const current = requireSettings();
      const reductions = browserProtectionReductions(current, validatedPatch);
      if (reductions.length > 0) {
        const { response } = await showPrompt(
          {
            kind: 'warning',
            buttons: ['Apply change', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Reduce DROIDEX Browser protection?',
            message: 'This change gives agents or websites more browser access.',
            detail: `${reductions.join('\n')}\n\nOnly apply this change if you trust the agents and websites using the browser.`,
          },
          { signal },
        );
        signal.throwIfAborted();
        if (response !== 0) return snapshot();
      }
      const next = validateSettings(
        { ...current, ...validatedPatch },
        createDefaultBrowserSettings(downloadsPath),
      );
      await writeSettings(settingsPath, next, signal);
      settings = next;
      return snapshot();
    });
    writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function cancelPendingUpdates() {
    pendingUpdates.abort(
      new Error('Browser settings update cancelled because its renderer closed.'),
    );
    pendingUpdates = new AbortController();
  }

  function assertAgentAccess() {
    if (!requireSettings().agentAccessEnabled) {
      throw new Error('Agent browser access is off. Enable it in Settings > Browser.');
    }
  }

  async function authorizeAgentOrigin(url, autonomy, signal) {
    const origin = exactHttpOrigin(url);
    assertAgentAccess();
    signal.throwIfAborted();
    const approval = effectiveNavigationApproval(requireSettings().navigationApproval, autonomy);
    if (approval === 'never_ask') return;
    if (approval === 'new_sites' && approvedOrigins.has(origin)) return;
    const mayRemember = approval === 'new_sites';
    const cancelId = mayRemember ? 2 : 1;
    const { response, cancelled } = await showPrompt(
      {
        kind: 'question',
        buttons: mayRemember
          ? ['Allow once', 'Always allow this site', 'Cancel']
          : ['Allow once', 'Cancel'],
        defaultId: cancelId,
        cancelId,
        title: 'Allow agent website access?',
        message: `Allow the agent to open ${origin}?`,
        detail:
          'Approval applies to this exact website origin. Passwords and cookie values remain hidden from the agent.',
      },
      { signal },
    );
    signal.throwIfAborted();
    assertAgentAccess();
    if (cancelled || response === cancelId)
      throw new Error(`Agent website access was denied for ${origin}.`);
    if (mayRemember && response === 1) approvedOrigins.add(origin);
  }

  return {
    settingsPath,
    initialize,
    snapshot,
    update,
    cancelPendingUpdates,
    assertAgentAccess,
    authorizeAgentOrigin,
  };
}

module.exports = { createBrowserSettingsController };
