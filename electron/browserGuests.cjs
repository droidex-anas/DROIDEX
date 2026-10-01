const { randomUUID } = require('node:crypto');

// Pages live in <webview> guests that the app renderer mounts, but main
// decides everything about them. The renderer may only mount a guest with a
// one-time token main issued for a browser session; main then replaces the
// guest's preferences and parameters wholesale (a partial override let a
// page-chosen user agent and popups through), binds the guest to its session
// the moment it is created, and navigates it itself.

const TOKEN_SRC_PREFIX = 'about:blank#droidex=';
const BIND_TIMEOUT_MS = 10_000;

function createBrowserGuests({ partition, preloadPath, onBound }) {
  const reservations = new Map(); // token -> { browserSessionId, generation, hostId }
  const guests = new Map(); // browserSessionId -> { contents, generation }
  const waiters = new Map(); // browserSessionId -> Set<(contents) => void>
  let nextGeneration = 0;
  // The reservation accepted by will-attach-webview, claimed by the guest
  // created synchronously right after it.
  let attaching = null;

  function reserve(browserSessionId, host) {
    const token = randomUUID();
    const generation = ++nextGeneration;
    reservations.set(token, { browserSessionId, generation, hostId: host.id });
    return { src: `${TOKEN_SRC_PREFIX}${token}`, generation };
  }

  function handleWillAttach(event, webPreferences, params, host) {
    const token = tokenFrom(params.src);
    const reservation = token ? reservations.get(token) : undefined;
    if (token) reservations.delete(token);
    if (!reservation || reservation.hostId !== host.id) {
      event.preventDefault();
      return;
    }
    replaceAll(webPreferences, {
      partition,
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      // The page preload still loads a sibling module, so guests run without
      // the sandbox exactly as main's views do today; the new bundled page
      // script restores it.
      sandbox: false,
      webSecurity: true,
      webviewTag: false,
      plugins: false,
      disablePopups: true,
    });
    replaceAll(params, { instanceId: params.instanceId, src: 'about:blank' });
    attaching = reservation;
  }

  // app 'web-contents-created' for every contents; only webview guests matter.
  function handleCreated(contents) {
    if (contents.getType() !== 'webview') return;
    const reservation = attaching;
    attaching = null;
    if (!reservation) {
      // A guest main never reserved: nothing may run in it.
      contents.close();
      return;
    }
    const { browserSessionId, generation } = reservation;
    guests.set(browserSessionId, { contents, generation });
    contents.once('destroyed', () => {
      if (guests.get(browserSessionId)?.contents === contents) guests.delete(browserSessionId);
    });
    onBound(browserSessionId, contents);
    for (const resolve of waiters.get(browserSessionId) ?? []) resolve(contents);
    waiters.delete(browserSessionId);
  }

  function guestFor(browserSessionId) {
    const guest = guests.get(browserSessionId);
    return guest && !guest.contents.isDestroyed() ? guest.contents : undefined;
  }

  function waitForGuest(browserSessionId, timeoutMs = BIND_TIMEOUT_MS) {
    const existing = guestFor(browserSessionId);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const set = waiters.get(browserSessionId) ?? new Set();
      const timer = setTimeout(() => {
        set.delete(settle);
        reject(new Error('The browser page did not start in time.'));
      }, timeoutMs);
      function settle(contents) {
        clearTimeout(timer);
        resolve(contents);
      }
      set.add(settle);
      waiters.set(browserSessionId, set);
    });
  }

  function release(browserSessionId) {
    for (const [token, reservation] of reservations) {
      if (reservation.browserSessionId === browserSessionId) reservations.delete(token);
    }
    guests.delete(browserSessionId);
  }

  function sessionIdFor(contents) {
    for (const [browserSessionId, guest] of guests) {
      if (guest.contents === contents) return browserSessionId;
    }
    return undefined;
  }

  return {
    reserve,
    handleWillAttach,
    handleCreated,
    guestFor,
    waitForGuest,
    release,
    sessionIdFor,
  };
}

function tokenFrom(src) {
  return typeof src === 'string' && src.startsWith(TOKEN_SRC_PREFIX)
    ? src.slice(TOKEN_SRC_PREFIX.length) || undefined
    : undefined;
}

function replaceAll(target, values) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, values);
}

module.exports = { createBrowserGuests };
