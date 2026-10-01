// Tablet and Phone show a page the way a touch device gets it: Chrome for
// Android's user agent, for sites that choose their version on the server, and
// touch input, for pages that look for it. A page can also be asked for its
// light or dark scheme. All of it belongs to the guest, so a guest mounted
// again for the same page is given it again.

const { runWithWebContentsDebugger } = require('./nativeBrowserEmulation.cjs');

// Chrome for Android's user agent at this Chromium's version; a tablet's has
// no "Mobile".
function touchUserAgent(viewportMode) {
  if (viewportMode !== 'tablet' && viewportMode !== 'mobile') return undefined;
  const chrome = `${process.versions.chrome.split('.')[0]}.0.0.0`;
  const mobile = viewportMode === 'mobile' ? 'Mobile ' : '';
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} ${mobile}Safari/537.36`;
}

const applied = new WeakMap(); // guest contents -> { userAgent, scheme } it has

// From the browser's entry: its size's name and the scheme asked for. The user
// agent counts from the page's next load; touch and the scheme at once. Each is
// sent only when it changes, so a size never touches the page's scheme.
function useDevice(contents, { viewportMode, colorScheme }) {
  if (!contents || contents.isDestroyed()) return;
  const userAgent = touchUserAgent(viewportMode);
  const scheme = colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : undefined;
  const had = applied.get(contents) ?? {};
  applied.set(contents, { userAgent, scheme });
  if (had.userAgent !== userAgent)
    contents.setUserAgent(userAgent ?? contents.session.getUserAgent());
  emulate(contents, { touch: had.userAgent !== userAgent, media: had.scheme !== scheme });
}

// A guest just mounted has no page yet to take touch or a scheme, so they are
// set again once the guest's first page commits.
function mountDevice(contents, entry) {
  useDevice(contents, entry);
  const { userAgent, scheme } = applied.get(contents) ?? {};
  if (userAgent || scheme)
    contents.once('did-navigate', () =>
      emulate(contents, { touch: Boolean(userAgent), media: Boolean(scheme) }),
    );
}

function emulate(contents, { touch, media }) {
  if (!touch && !media) return;
  const { userAgent, scheme } = applied.get(contents) ?? {};
  // A guest that closes meanwhile has nothing left to set up.
  void runWithWebContentsDebugger(contents, async (dbg) => {
    if (touch)
      await dbg.sendCommand(
        'Emulation.setTouchEmulationEnabled',
        userAgent ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
    if (media)
      await dbg.sendCommand('Emulation.setEmulatedMedia', {
        features: scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : [],
      });
  }).catch(() => {});
}

module.exports = { useDevice, mountDevice };
