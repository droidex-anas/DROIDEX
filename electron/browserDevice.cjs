// Tablet and Phone show a page the way a touch device gets it: Chrome for
// Android's user agent, for sites that choose their version on the server, and
// touch input, for pages that look for it. Both belong to the guest, so a guest
// mounted again for the same page is given them again.

const { runWithWebContentsDebugger } = require('./nativeBrowserEmulation.cjs');

// Chrome for Android's user agent at this Chromium's version; a tablet's has
// no "Mobile".
function touchUserAgent(viewportMode) {
  if (viewportMode !== 'tablet' && viewportMode !== 'mobile') return undefined;
  const chrome = `${process.versions.chrome.split('.')[0]}.0.0.0`;
  const mobile = viewportMode === 'mobile' ? 'Mobile ' : '';
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} ${mobile}Safari/537.36`;
}

const devices = new WeakMap(); // guest contents -> the touch user agent it has

// The user agent counts from the page's next load; touch at once.
function useDevice(contents, viewportMode) {
  const userAgent = touchUserAgent(viewportMode);
  if (!contents || contents.isDestroyed() || devices.get(contents) === userAgent) return;
  devices.set(contents, userAgent);
  contents.setUserAgent(userAgent ?? contents.session.getUserAgent());
  setTouch(contents);
}

// A guest just mounted has no page yet to take touch, so it is set again once
// the guest's first page commits.
function mountDevice(contents, viewportMode) {
  useDevice(contents, viewportMode);
  if (devices.get(contents)) contents.once('did-navigate', () => setTouch(contents));
}

function setTouch(contents) {
  const enabled = Boolean(devices.get(contents));
  // A guest that closes meanwhile has nothing left to set up.
  void runWithWebContentsDebugger(contents, (dbg) =>
    dbg.sendCommand(
      'Emulation.setTouchEmulationEnabled',
      enabled ? { enabled, maxTouchPoints: 5 } : { enabled },
    ),
  ).catch(() => {});
}

module.exports = { useDevice, mountDevice };
