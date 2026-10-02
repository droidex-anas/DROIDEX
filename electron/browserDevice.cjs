// Tablet and Phone show a page the way a touch device gets it: Chrome for
// Android's user agent, for sites that choose their version on the server, and
// touch (touch points and a coarse pointer), for pages that look for it; input
// stays mouse input. A page can also be asked for its light or dark scheme. All
// of it belongs to the guest, so a guest mounted again for the same page is
// given it again. It reaches the page's own process: a cross-site frame keeps
// its own touch and scheme, and takes the user agent like the rest.

const { runWithWebContentsDebugger } = require('./nativeBrowserEmulation.cjs');

// Chrome for Android's user agent at this Chromium's version; a tablet's has
// no "Mobile".
function touchUserAgent(viewportMode) {
  if (viewportMode !== 'tablet' && viewportMode !== 'mobile') return undefined;
  const chrome = `${process.versions.chrome.split('.')[0]}.0.0.0`;
  const mobile = viewportMode === 'mobile' ? 'Mobile ' : '';
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} ${mobile}Safari/537.36`;
}

// guest contents -> { settings and device it has taken, its change in progress }
const guests = new WeakMap();
// After a send failed, what the guest has is not known: the next change sends
// everything.
const UNKNOWN = { userAgent: null, scheme: null };
const EMULATE_MS = 15_000;

// The device a size's name and a scheme ask for.
function deviceOf({ viewportMode, colorScheme }) {
  return {
    userAgent: touchUserAgent(viewportMode),
    scheme: colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : undefined,
  };
}

// Gives a guest a new size's name, scheme or both, one change at a time. It
// rejects when the guest refuses the change, and the guest keeps what it had.
function useDevice(contents, change) {
  if (!contents || contents.isDestroyed()) return Promise.resolve();
  const guest = guests.get(contents) ?? { settings: {}, device: {}, turn: undefined };
  guests.set(contents, guest);
  const next = () => take(contents, guest, change);
  // The first change runs at once, so a guest has its user agent before it loads.
  guest.turn = guest.turn ? guest.turn.then(next, next) : next();
  return guest.turn;
}

// The user agent counts from the page's next load; touch and the scheme at
// once. Each is sent only when it changes, so a size never touches the page's
// scheme.
async function take(contents, guest, change) {
  if (contents.isDestroyed()) return;
  const settings = { ...guest.settings, ...change };
  const device = deviceOf(settings);
  const had = guest.device;
  const touch = had.userAgent !== device.userAgent;
  const setUserAgent = (userAgent) =>
    contents.setUserAgent(userAgent ?? contents.session.getUserAgent());
  if (touch) setUserAgent(device.userAgent);
  try {
    await emulate(contents, device, { touch, media: had.scheme !== device.scheme });
  } catch (error) {
    guest.device = UNKNOWN;
    if (touch && !contents.isDestroyed()) setUserAgent(deviceOf(guest.settings).userAgent);
    throw error;
  }
  guest.settings = settings;
  guest.device = device;
}

// Gives a guest that was just mounted what its entry asks for, and resolves
// once its page may load. Such a guest has no page yet to take touch or a
// scheme, so one that needs them is first given a blank page to take them on;
// its real page then starts with them in place. A failure that is not the
// guest closing is logged: nobody waits on a mounted guest.
async function mountDevice(contents, entry) {
  const { userAgent, scheme } = deviceOf(entry);
  try {
    // A real load that overtakes the blank one ends it, which is fine.
    if (userAgent || scheme) await contents.loadURL('about:blank').catch(() => undefined);
    // What the entry asks for by now: a change made meanwhile stands.
    const { viewportMode, colorScheme } = entry;
    await useDevice(contents, { viewportMode, colorScheme });
  } catch (error) {
    if (!contents.isDestroyed())
      console.error(`failed to set up a browser page's device: ${error.message}`);
  }
}

// A command the guest never answers is given up on, so it cannot hold the
// guest's later changes for good.
async function emulate(contents, { userAgent, scheme }, { touch, media }) {
  if (!touch && !media) return;
  const sent = runWithWebContentsDebugger(contents, async (dbg) => {
    if (touch)
      await dbg.sendCommand(
        'Emulation.setTouchEmulationEnabled',
        userAgent ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
    if (media)
      await dbg.sendCommand('Emulation.setEmulatedMedia', {
        features: scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : [],
      });
  });
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The browser page did not take its device in time.')),
      EMULATE_MS,
    );
  });
  await Promise.race([sent, late]).finally(() => clearTimeout(timer));
}

module.exports = { useDevice, mountDevice };
