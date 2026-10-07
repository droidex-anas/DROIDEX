const { randomUUID } = require('node:crypto');

// Pages live in <webview> guests that the app renderer mounts, but main
// decides everything about them. The renderer may only mount a guest with a
// one-time token main issued for a browser session; main then replaces the
// guest's preferences and parameters wholesale (a partial override let a
// page-chosen user agent through), claims the guest for its session
// the moment it is created, binds it once it attaches, and navigates it itself.

const TOKEN_SRC_PREFIX = 'about:blank#droidex=';
const BIND_TIMEOUT_MS = 10_000;

function createBrowserGuests({ partition, preloadPath, onBound }) {
  const reservations = new Map(); // token -> { browserSessionId, generation, hostId }
  const claimed = new Map(); // guest contents -> reservation, until it attaches
  const guests = new Map(); // browserSessionId -> { contents, generation }
  const waiters = new Map(); // browserSessionId -> Set<{ resolve, reject }>
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
      // Main's window-open handler admits only user or approved sign-in popups.
      disablePopups: false,
    });
    // Electron loads `src` once the guest attaches, after main's own
    // navigation; an empty one leaves every navigation to main.
    replaceAll(params, { instanceId: params.instanceId, src: '' });
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
    claimed.set(contents, reservation);
    contents.once('destroyed', () => claimed.delete(contents));
  }

  // The embedder's 'did-attach-webview': the guest can now be navigated.
  function handleAttached(contents) {
    const reservation = claimed.get(contents);
    claimed.delete(contents);
    if (!reservation || contents.isDestroyed()) return;
    const { browserSessionId, generation } = reservation;
    guests.set(browserSessionId, { contents, generation });
    contents.once('destroyed', () => {
      if (guests.get(browserSessionId)?.contents === contents) guests.delete(browserSessionId);
    });
    onBound(browserSessionId, contents);
    settleWaiters(browserSessionId, (waiter) => waiter.resolve(contents));
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
      waiters.set(browserSessionId, set);
      const timer = setTimeout(() => {
        set.delete(waiter);
        if (set.size === 0 && waiters.get(browserSessionId) === set)
          waiters.delete(browserSessionId);
        reject(new Error('The browser page did not start in time.'));
      }, timeoutMs);
      const waiter = {
        resolve: (contents) => {
          clearTimeout(timer);
          resolve(contents);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      set.add(waiter);
    });
  }

  function settleWaiters(browserSessionId, settle) {
    const set = waiters.get(browserSessionId);
    waiters.delete(browserSessionId);
    for (const waiter of set ?? []) settle(waiter);
  }

  function release(browserSessionId) {
    for (const [token, reservation] of reservations) {
      if (reservation.browserSessionId === browserSessionId) reservations.delete(token);
    }
    for (const [contents, reservation] of claimed) {
      if (reservation.browserSessionId === browserSessionId) claimed.delete(contents);
    }
    guests.delete(browserSessionId);
    settleWaiters(browserSessionId, (waiter) =>
      waiter.reject(new Error('The browser page was closed.')),
    );
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
    handleAttached,
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
