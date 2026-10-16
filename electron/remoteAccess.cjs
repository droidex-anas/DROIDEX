const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createRemoteAccess(options) {
  let hostPromise = null;
  let blocker = null;
  let enabled = false;
  let writes = Promise.resolve();
  const filename = path.join(options.app.getPath('userData'), 'remote-access.bin');

  function encryptionAvailable() {
    if (
      !options.safeStorage.isEncryptionAvailable() ||
      options.safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new Error(
        'Remote access requires the operating system keychain. Unlock it and restart Droidex.',
      );
    }
  }

  async function load() {
    let bytes;
    try {
      bytes = await fs.readFile(filename);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    encryptionAvailable();
    return options.safeStorage.decryptString(bytes);
  }

  function save(value) {
    const run = writes.then(async () => {
      encryptionAvailable();
      const temporary = `${filename}.tmp`;
      await fs.writeFile(temporary, options.safeStorage.encryptString(value), { mode: 0o600 });
      await fs.rename(temporary, filename);
    });
    writes = run.catch(() => {});
    return run;
  }

  function keepAwake(enabled) {
    if (enabled && blocker === null)
      blocker = options.powerSaveBlocker.start('prevent-app-suspension');
    if (!enabled && blocker !== null) {
      options.powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  }

  function host() {
    hostPromise ??= import(pathToFileURL(options.hostModule).href).then((module) =>
      module.createRemoteHost({
        load,
        save,
        keepAwake,
        bridgeInfo: options.bridgeInfo,
        desktop: options.desktop,
        changed: (state) => {
          enabled = state.enabled;
          options.changed(state);
        },
        defaults: {
          relayUrl:
            process.env.DROIDEX_REMOTE_RELAY_URL || 'wss://droidex-relay.mdanas7869292.workers.dev',
          clientUrl: process.env.DROIDEX_REMOTE_CLIENT_URL || 'https://droidex.vercel.app',
        },
      }),
    );
    return hostPromise;
  }

  function registerIpc(desktopIpc) {
    const handlers = {
      'remote-state': async () => (await host()).snapshot(),
      'remote-configure': async (patch) => (await host()).configure(patch),
      'remote-setup': async () => (await host()).setup(),
      'remote-confirm': async (code) => (await host()).confirm(code),
      'remote-decide': async (value) => (await host()).decide(value?.id, value?.approved),
      'remote-revoke': async (id) => (await host()).revoke(id),
      'remote-reset': async () => (await host()).reset(),
      'profile-public-get': async () => (await host()).getPublishedProfile(),
      'profile-public-publish': async (payload) => (await host()).publishPublicProfile(payload),
      'profile-public-revoke': async (payload) => (await host()).revokePublicProfile(payload),
      'remote-qr': qrDataUrl,
    };
    for (const [channel, handler] of Object.entries(handlers)) desktopIpc.handle(channel, handler);
  }

  return {
    registerIpc,
    isEnabled: () => enabled,
    notifyDevices() {
      if (enabled) void host().then((remoteHost) => remoteHost.notifyDevices());
    },
    async resume() {
      try {
        await fs.access(filename);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      (await host()).resume();
    },
    async close() {
      if (hostPromise) await (await hostPromise).close();
      keepAwake(false);
      await writes;
    },
  };
}

function qrDataUrl(value) {
  if (typeof value !== 'string' || value.length > 1000 || !/^[\x20-\x7E]+$/.test(value))
    throw new Error('Invalid pairing code');
  const QRCode = require('./vendor/QRCode');
  const code = new QRCode(0, 1);
  code.addData(value);
  code.make();
  const size = code.getModuleCount();
  let pixels = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (code.isDark(y, x)) pixels += `M${x + 4} ${y + 4}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" shape-rendering="crispEdges"><path fill="white" d="M0 0h${size + 8}v${size + 8}H0z"/><path fill="black" d="${pixels}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = { createRemoteAccess };
