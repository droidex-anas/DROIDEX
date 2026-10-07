const { validateSitePermissionSelection } = require('./browserSettingsSchema.cjs');

const PERMISSION_LABELS = {
  camera: 'camera',
  microphone: 'microphone',
  geolocation: 'location',
  notifications: 'notifications',
  'clipboard-read': 'clipboard',
  midi: 'MIDI devices',
  midiSysex: 'MIDI system exclusive messages',
};
const MEDIA_PERMISSIONS = { audio: 'microphone', video: 'camera' };

function createBrowserPermissionController(options) {
  const states = new Map();
  const pendingRevocations = new Set();
  const platform = options.platform ?? process.platform;

  function isOwned(contents) {
    return contents && !contents.isDestroyed() && options.isNativeBrowserContents(contents);
  }

  function siteDecision(origin, permission) {
    for (const pending of pendingRevocations) {
      if (pending.origin === origin && pending.permission === permission) return 'deny';
    }
    return options.getSiteDecision(origin, permission);
  }

  function hasGrant(contents, origin, permission, frame) {
    const decision = siteDecision(origin, permission);
    if (decision === 'deny') return false;
    if (decision === 'allow') return true;
    const document = states.get(contents)?.grants.get(grantKey(origin, permission));
    return Boolean(
      document && (!frame || document.frame === frame) && isLiveDocument(contents, document),
    );
  }

  function canAccess(contents, permission, requestingOrigin, details = {}) {
    const permissions = requestedPermissions(permission, details.mediaType && [details.mediaType]);
    if (permissions.length === 0) return false;
    const origin = httpOrigin(requestingOrigin);
    if (!origin || !matchesSecurityOrigin(origin, details)) return false;

    // Electron checks notifications without a WebContents, including service workers.
    // Only a previous, explicit exact-origin approval can authorize those checks.
    if (!contents && permission === 'notifications') {
      if (httpOrigin(details.embeddingOrigin) !== origin) return false;
      const pages = options
        .listContents()
        .filter((page) => isOwned(page) && httpOrigin(page.mainFrame.origin) === origin);
      if (siteDecision(origin, permission) === 'allow') return true;
      return pages.some((page) => hasGrant(page, origin, permission));
    }
    if (!isOwned(contents)) return false;
    const frame = requestingFrame(contents, details);
    if (!frame || httpOrigin(frame.origin) !== origin) return false;
    return permissions.every(
      (name) => hasGrant(contents, origin, name, frame) && hasSystemMediaAccess(name),
    );
  }

  function handleRequest(contents, permission, callback, details = {}) {
    const permissions = requestedPermissions(permission, details.mediaTypes);
    const frame = isOwned(contents) ? requestingFrame(contents, details) : undefined;
    const origin = frame && httpOrigin(frame.origin);
    if (
      !isOwned(contents) ||
      !origin ||
      !matchesSecurityOrigin(origin, details) ||
      permissions.length === 0 ||
      permissions.some((name) => siteDecision(origin, name) === 'deny')
    ) {
      callback(false);
      return;
    }

    let state = states.get(contents);
    if (!state) {
      state = { grants: new Map(), pending: null };
      states.set(contents, state);
    }
    if (state.pending) {
      callback(false);
      return;
    }
    const document = { frame, processId: frame.processId, routingId: frame.routingId };
    const pending = { origin, permissions, document, abort: new AbortController(), saving: false };
    state.pending = pending;
    // The deadline cancels prompts and OS consent. A submitted save must report its result.
    const timeout = setTimeout(() => pending.abort.abort(), 120_000);
    let settled = false;
    const finish = (allowed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pending.abort.signal.removeEventListener('abort', cancelled);
      if (state.pending === pending) state.pending = null;
      callback(allowed);
    };
    const cancelled = () => {
      if (!pending.saving) finish(false);
    };
    pending.abort.signal.addEventListener('abort', cancelled, { once: true });
    void approve(contents, state, pending).then(finish, (error) => {
      if (!pending.abort.signal.aborted)
        console.error('Browser site permission failed:', error.message);
      finish(false);
    });
  }

  function isCurrent(contents, state, pending) {
    return (
      !pending.abort.signal.aborted &&
      states.get(contents) === state &&
      state.pending === pending &&
      isOwned(contents) &&
      isLiveDocument(contents, pending.document) &&
      httpOrigin(pending.document.frame.origin) === pending.origin &&
      pending.permissions.every((name) => siteDecision(pending.origin, name) !== 'deny')
    );
  }

  async function approve(contents, state, pending) {
    const { origin, permissions, abort } = pending;
    const needsApproval = permissions.filter(
      (name) => !hasGrant(contents, origin, name, pending.document.frame),
    );
    let response;
    if (needsApproval.length > 0) {
      const label = needsApproval.map((name) => PERMISSION_LABELS[name]).join(' and ');
      const answer = await options.showPrompt(
        {
          kind: 'permission',
          buttons: ['Allow', 'Allow once', "Don't allow", 'Always block this site'],
          defaultId: 2,
          cancelId: 2,
          title: `Allow ${label}?`,
          message: `${origin} wants to use your ${label}.`,
          detail:
            'This applies only to this exact website. Allow remembers your choice; Allow once lasts until this page navigates. macOS may also show its required first-use privacy confirmation.' +
            (options.isWorking(contents) ? '\nAn agent is working on this page.' : ''),
        },
        { signal: abort.signal },
      );
      if (!isCurrent(contents, state, pending) || answer.cancelled) return false;
      response = answer.response;
      if (response === 3) {
        pending.saving = true;
        await options.persistSiteDecision(
          { origin, permissions: needsApproval, decision: 'deny' },
          abort.signal,
        );
        return false;
      }
      if (response !== 0 && response !== 1) return false;
    }

    for (const name of permissions) {
      if (!isCurrent(contents, state, pending)) return false;
      if (!(await requestSystemMediaAccess(name, origin, abort.signal))) return false;
      if (!isCurrent(contents, state, pending)) return false;
    }
    if (response === 0) {
      pending.saving = true;
      await options.persistSiteDecision(
        { origin, permissions: needsApproval, decision: 'allow' },
        abort.signal,
      );
      return true;
    }
    if (response === 1) {
      for (const name of needsApproval) state.grants.set(grantKey(origin, name), pending.document);
    }
    return true;
  }

  function hasSystemMediaAccess(permission) {
    if (platform !== 'darwin' || !isMedia(permission)) return true;
    return options.systemPreferences.getMediaAccessStatus(permission) === 'granted';
  }

  async function requestSystemMediaAccess(permission, origin, signal) {
    if (platform !== 'darwin' || !isMedia(permission)) return true;
    const status = options.systemPreferences.getMediaAccessStatus(permission);
    if (status === 'granted') return true;
    if (status === 'not-determined') {
      const allowed = await options.systemPreferences.askForMediaAccess(permission);
      if (signal.aborted) return false;
      if (allowed && hasSystemMediaAccess(permission)) return true;
    }
    if (signal.aborted) return false;
    const { response, cancelled } = await options.showPrompt(
      {
        kind: 'warning',
        title: `macOS blocked ${permission} access`,
        message: `${origin} cannot use your ${permission} because macOS has not allowed DROIDEX access.`,
        detail: `Open System Settings > Privacy & Security > ${PERMISSION_LABELS[permission]} and allow DROIDEX, then restart DROIDEX and try again. If access is restricted, contact your Mac administrator.`,
        buttons: ['Open System Settings', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      },
      { signal },
    );
    if (!signal.aborted && !cancelled && response === 0) {
      const pane = permission === 'camera' ? 'Camera' : 'Microphone';
      await options.openExternal(
        `x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`,
      );
    }
    return false;
  }

  async function revokeSitePermission(origin, permission) {
    validateSitePermissionSelection(origin, [permission]);
    const write = { origin, permission };
    pendingRevocations.add(write);
    for (const state of states.values()) {
      state.grants.delete(grantKey(origin, permission));
      if (state.pending?.origin === origin && state.pending.permissions.includes(permission))
        state.pending.abort.abort();
    }
    try {
      return await options.persistSiteDecision(
        { origin, permissions: [permission], decision: 'ask' },
        new AbortController().signal,
      );
    } finally {
      pendingRevocations.delete(write);
    }
  }

  function revokeForContents(contents) {
    const state = states.get(contents);
    states.delete(contents);
    state?.pending?.abort.abort();
  }

  function revokeAll() {
    for (const contents of states.keys()) revokeForContents(contents);
  }

  return { canAccess, handleRequest, revokeForContents, revokeSitePermission, revokeAll };
}

function requestedPermissions(permission, mediaTypes) {
  if (permission !== 'media') {
    return Object.hasOwn(PERMISSION_LABELS, permission) && !isMedia(permission) ? [permission] : [];
  }
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) return [];
  if (mediaTypes.some((type) => !Object.hasOwn(MEDIA_PERMISSIONS, type))) return [];
  return [...new Set(mediaTypes.map((type) => MEDIA_PERMISSIONS[type]))];
}

function isMedia(permission) {
  return permission === 'camera' || permission === 'microphone';
}

function httpOrigin(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
  return url.origin;
}

function matchesSecurityOrigin(origin, details) {
  return ['securityOrigin', 'requestingOrigin'].every(
    (key) => !Object.hasOwn(details, key) || httpOrigin(details[key]) === origin,
  );
}

function requestingFrame(contents, details) {
  const mainFrame = contents.mainFrame;
  const origin = httpOrigin(mainFrame.origin);
  if (!origin || httpOrigin(details.requestingUrl) !== origin) return undefined;
  if (typeof details.isMainFrame !== 'boolean') return undefined;
  // Electron gives permission requests a URL but no frame ID. Ambiguous matches deny.
  const frames = mainFrame.framesInSubtree.filter(
    (frame) =>
      !frame.isDestroyed() &&
      !frame.detached &&
      (frame === mainFrame) === details.isMainFrame &&
      frame.url === details.requestingUrl,
  );
  if (frames.length !== 1 || httpOrigin(frames[0].origin) !== origin) return undefined;
  return frames[0];
}

function isLiveDocument(contents, { frame, processId, routingId }) {
  return (
    !frame.isDestroyed() &&
    !frame.detached &&
    frame.processId === processId &&
    frame.routingId === routingId &&
    contents.mainFrame.framesInSubtree.includes(frame)
  );
}

function grantKey(origin, permission) {
  return `${origin}\0${permission}`;
}

module.exports = { createBrowserPermissionController };
