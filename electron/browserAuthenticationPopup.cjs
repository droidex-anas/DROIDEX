const POPUP_CAPABILITY_TTL_MS = 10_000;
const USER_GESTURE_TTL_MS = 1_000;
const agentActivity = new WeakMap();

function activityFor(contents) {
  let activity = agentActivity.get(contents);
  if (!activity) {
    activity = { count: 0, generation: 0 };
    agentActivity.set(contents, activity);
  }
  return activity;
}

function beginAgentBrowserAction(entry, contents, request) {
  const activity = activityFor(contents);
  activity.count++;
  activity.generation++;
  entry.authenticationPopupCapability = null;
  return () => {
    activity.count--;
    if (entry.authenticationPopupCapability?.request === request)
      entry.authenticationPopupCapability = null;
  };
}

function grantAuthenticationPopup(entry, contents, targetUrl, request, now = Date.now()) {
  const url = safeHttpUrl(targetUrl);
  if (!url || url.length > 8_192)
    throw new Error('Authentication popups require an exact HTTP(S) target.');
  entry.authenticationPopupCapability = {
    contents,
    documents: entry.documents,
    targetUrl: url,
    expiresAt: Math.min(now + POPUP_CAPABILITY_TTL_MS, request.startBy),
    request,
  };
}

function consumeAuthenticationPopup(entry, contents, url, now = Date.now()) {
  const capability = entry.authenticationPopupCapability;
  entry.authenticationPopupCapability = null;
  if (!capability) return undefined;
  const matches =
    capability.contents === contents &&
    entry.contents === contents &&
    capability.documents === entry.documents &&
    capability.expiresAt > now &&
    !capability.request.signal.aborted &&
    capability.targetUrl === safeHttpUrl(url);
  if (!matches) return false;
  try {
    return !capability.request.runEnded();
  } catch {
    // Policy revocation rejects the sidecar request rather than returning a boolean.
    return false;
  }
}

function createBrowserAuthenticationPopups({ partition, isAllowedUrl, loadUrl, getMainWindow }) {
  const bindings = new Map();

  function close(entry) {
    entry.authenticationPopupCapability = null;
    const binding = bindings.get(entry);
    if (!binding) return;
    bindings.delete(entry);
    binding.dispose();
    for (const window of binding.windows) window.destroy();
  }

  function bind(entry, contents) {
    close(entry);
    const windows = new Set();
    const activity = activityFor(contents);
    let gesture = null;
    const current = () => entry.contents === contents && !contents.isDestroyed();
    const recordGesture = () => {
      gesture = activity.count
        ? null
        : { documents: entry.documents, agentGeneration: activity.generation, at: Date.now() };
    };
    const onMouse = (_event, input) => {
      if (input.type === 'mouseDown') recordGesture();
    };
    const onKey = (_event, input) => {
      if (input.type === 'keyDown' && ['Enter', ' '].includes(input.key)) recordGesture();
    };
    const onNavigation = (_event, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return;
      gesture = null;
      entry.authenticationPopupCapability = null;
      for (const window of windows) window.destroy();
    };
    const onDestroyed = () => close(entry);
    contents.on('before-mouse-event', onMouse);
    contents.on('before-input-event', onKey);
    contents.on('did-start-navigation', onNavigation);
    contents.once('destroyed', onDestroyed);
    contents.setWindowOpenHandler((details) => {
      if (!current()) return { action: 'deny' };
      const approved = consumeAuthenticationPopup(entry, contents, details.url);
      const userGesture =
        !activity.count &&
        gesture?.agentGeneration === activity.generation &&
        gesture?.documents === entry.documents &&
        Date.now() - gesture.at < USER_GESTURE_TTL_MS;
      gesture = null;
      if (!safeHttpUrl(details.url) || !isAllowedUrl(details.url)) return { action: 'deny' };
      if (approved === false) return { action: 'deny' };
      if (approved || (userGesture && isSignInPopup(details))) {
        return {
          action: 'allow',
          outlivesOpener: false,
          overrideBrowserWindowOptions: {
            parent: getMainWindow(),
            title: 'DROIDEX secure sign-in',
            width: 520,
            height: 720,
            minWidth: 420,
            minHeight: 560,
            show: true,
            frame: true,
            transparent: false,
            fullscreen: false,
            fullscreenable: false,
            alwaysOnTop: false,
            autoHideMenuBar: true,
            webPreferences: {
              partition,
              preload: '',
              contextIsolation: true,
              nodeIntegration: false,
              nodeIntegrationInSubFrames: false,
              sandbox: true,
              webSecurity: true,
              webviewTag: false,
              disablePopups: true,
            },
          },
        };
      }
      // Unapproved sign-in popups must not silently become agent navigations.
      if (!userGesture && isSignInPopup(details)) return { action: 'deny' };
      void loadUrl(entry, details.url);
      return { action: 'deny' };
    });
    const onWindow = (window) => {
      if (!current()) {
        window.destroy();
        return;
      }
      windows.add(window);
      hardenAuthenticationPopup(window, isAllowedUrl);
      window.once('closed', () => {
        windows.delete(window);
        if (current()) contents.focus();
      });
    };
    contents.on('did-create-window', onWindow);
    bindings.set(entry, {
      windows,
      dispose() {
        contents.removeListener('before-mouse-event', onMouse);
        contents.removeListener('before-input-event', onKey);
        contents.removeListener('did-start-navigation', onNavigation);
        contents.removeListener('destroyed', onDestroyed);
        contents.removeListener('did-create-window', onWindow);
      },
    });
  }

  return { bind, close };
}

function isSignInPopup({ url, features = '', disposition }) {
  return (
    disposition === 'new-window' ||
    /(?:^|,)\s*(?:popup|width|height)(?:=|,|$)/i.test(features) ||
    /(?:^|\/)(?:oauth\d*|authorize|authorization|signin|sign-in|login|saml|sso)(?:\/|$)/i.test(
      new URL(url).pathname,
    )
  );
}

function hardenAuthenticationPopup(window, isAllowedUrl) {
  window.setMenuBarVisibility(false);
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!safeHttpUrl(url) || !isAllowedUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && (!safeHttpUrl(url) || !isAllowedUrl(url))) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    ? url.href
    : undefined;
}

module.exports = {
  beginAgentBrowserAction,
  createBrowserAuthenticationPopups,
  consumeAuthenticationPopup,
  grantAuthenticationPopup,
};
