const path = require('node:path');
const {
  createDefaultBrowserSettings,
  readSettings,
  validateSettings,
  validateSettingsPatch,
  browserProtectionReductions,
  writeSettings,
  SITE_PERMISSIONS,
  validateSitePermissionSelection,
  validateSiteDecision,
} = require('./browserSettingsSchema.cjs');

function createBrowserSettingsController({
  userDataPath,
  downloadsPath,
  showPrompt,
  onSitePermissionModeChanged,
}) {
  const settingsPath = path.join(userDataPath, 'browser-settings.json');
  let settings;
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
      approvedAgentOrigins: [...current.approvedAgentOrigins].sort(),
      sitePermissionRules: current.sitePermissions
        .map((rule) => ({ ...rule }))
        .sort((left, right) => left.origin.localeCompare(right.origin)),
    };
  }

  function update(patch) {
    const validatedPatch = validateSettingsPatch(patch);
    const { signal } = pendingUpdates;
    // Check protection against the state this write replaces, including earlier queued writes.
    return queueMutation(async (current) => {
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
        if (response !== 0) return undefined;
      }
      return { ...current, ...validatedPatch };
    }, signal);
  }

  function queueMutation(mutate, signal) {
    const run = writes.then(async () => {
      signal.throwIfAborted();
      const current = requireSettings();
      const changed = await mutate(current);
      signal.throwIfAborted();
      if (!changed) return snapshot();
      const next = validateSettings(changed, createDefaultBrowserSettings(downloadsPath));
      await writeSettings(settingsPath, next, signal);
      // writeSettings resolves only after commitment. Cancellation cannot undo that write.
      settings = next;
      if (current.sitePermissionMode !== next.sitePermissionMode) onSitePermissionModeChanged?.();
      return snapshot();
    });
    writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function getSitePermissionDecision(origin, permission) {
    const current = requireSettings();
    if (current.sitePermissionMode === 'block') return 'deny';
    return current.sitePermissions.find((rule) => rule.origin === origin)?.[permission] ?? 'ask';
  }

  function setSitePermissionDecision({ origin, permissions, decision }, signal) {
    validateSitePermissionSelection(origin, permissions);
    validateSiteDecision(decision);
    const writeSignal = AbortSignal.any([pendingUpdates.signal, signal]);
    return queueMutation((current) => {
      const previous = current.sitePermissions.find((rule) => rule.origin === origin);
      const rule = previous
        ? { ...previous }
        : { origin, ...Object.fromEntries(SITE_PERMISSIONS.map((key) => [key, 'ask'])) };
      for (const permission of permissions) rule[permission] = decision;
      const sitePermissions = current.sitePermissions.filter((entry) => entry.origin !== origin);
      if (SITE_PERMISSIONS.some((key) => rule[key] !== 'ask')) sitePermissions.push(rule);
      return { ...current, sitePermissions };
    }, writeSignal);
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

  return {
    settingsPath,
    initialize,
    snapshot,
    update,
    cancelPendingUpdates,
    assertAgentAccess,
    getSitePermissionDecision,
    setSitePermissionDecision,
  };
}

module.exports = { createBrowserSettingsController };
