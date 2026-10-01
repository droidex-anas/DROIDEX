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

const applied = new WeakMap(); // guest contents -> { userAgent, scheme } it has taken

// What a browser's entry asks of its guest: its size's name and its scheme.
function deviceOf({ viewportMode, colorScheme }) {
  return {
    userAgent: touchUserAgent(viewportMode),
    scheme: colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : undefined,
  };
}

// The user agent counts from the page's next load; touch and the scheme at
// once. Each is sent only when it changes, so a size never touches the page's
// scheme, and counts as taken only once the guest has answered.
async function useDevice(contents, entry) {
  if (!contents || contents.isDestroyed()) return;
  const device = deviceOf(entry);
  const had = applied.get(contents) ?? {};
  const touch = had.userAgent !== device.userAgent;
  if (touch) contents.setUserAgent(device.userAgent ?? contents.session.getUserAgent());
  await emulate(contents, device, { touch, media: had.scheme !== device.scheme });
  applied.set(contents, device);
}

// A guest just mounted has no page yet to take touch or a scheme, so they are
// sent again once its first page commits. Nobody waits on a mounted guest, so
// a failure that is not the guest closing is logged.
function mountDevice(contents, entry) {
  const failed = (error) => {
    if (!contents.isDestroyed())
      console.error(`failed to set up a browser page's device: ${error.message}`);
  };
  contents.once('did-navigate', () => {
    const device = deviceOf(entry);
    const again = { touch: Boolean(device.userAgent), media: Boolean(device.scheme) };
    emulate(contents, device, again).catch(failed);
  });
  useDevice(contents, entry).catch(failed);
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
