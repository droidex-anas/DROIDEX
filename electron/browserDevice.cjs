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

// The device a size's name and a scheme ask for.
function deviceOf({ viewportMode, colorScheme }) {
  return {
    userAgent: touchUserAgent(viewportMode),
    scheme: colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : undefined,
  };
}

// Gives a guest a new size's name, scheme or both, one change at a time. It
// rejects when the guest refuses the change, and the guest keeps what it had.
// `again` sends what the guest already has once more.
function useDevice(contents, change, again = false) {
  if (!contents || contents.isDestroyed()) return Promise.resolve();
  const guest = guests.get(contents) ?? { settings: {}, device: {}, turn: undefined };
  guests.set(contents, guest);
  const next = () => take(contents, guest, change, again);
  // The first change runs at once, so a guest has its user agent before it loads.
  guest.turn = guest.turn ? guest.turn.then(next, next) : next();
  return guest.turn;
}

// The user agent counts from the page's next load; touch and the scheme at
// once. Each is sent only when it changes, so a size never touches the page's
// scheme.
async function take(contents, guest, change, again) {
  if (contents.isDestroyed()) return;
  const settings = { ...guest.settings, ...change };
  const device = deviceOf(settings);
  // Sent again, a guest is measured against one with nothing set.
  const had = again && guest.device !== UNKNOWN ? {} : guest.device;
  const defaultUserAgent = contents.session.getUserAgent();
  const touch = had.userAgent !== device.userAgent;
  if (touch) contents.setUserAgent(device.userAgent ?? defaultUserAgent);
  try {
    await emulate(contents, device, { touch, media: had.scheme !== device.scheme });
  } catch (error) {
    guest.device = UNKNOWN;
    if (!contents.isDestroyed())
      contents.setUserAgent(deviceOf(guest.settings).userAgent ?? defaultUserAgent);
    throw error;
  }
  guest.settings = settings;
  guest.device = device;
}

// A guest just mounted has no page yet to take touch or a scheme, so they are
// sent again once its first page commits. Nobody waits on a mounted guest, so
// a failure that is not the guest closing is logged.
function mountDevice(contents, entry) {
  const failed = (error) => {
    if (!contents.isDestroyed())
      console.error(`failed to set up a browser page's device: ${error.message}`);
  };
  contents.once('did-navigate', () => useDevice(contents, {}, true).catch(failed));
  const { viewportMode, colorScheme } = entry;
  useDevice(contents, { viewportMode, colorScheme }).catch(failed);
}

async function emulate(contents, { userAgent, scheme }, { touch, media }) {
  if (!touch && !media) return;
  await runWithWebContentsDebugger(contents, async (dbg) => {
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
}

module.exports = { useDevice, mountDevice };
