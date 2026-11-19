const { app } = require('electron');
const path = require('node:path');

function appRoot() {
  // Packaged app files (renderer dist, electron/) live inside app.asar, which
  // Electron resolves transparently for loadFile/loadURL.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar')
    : path.resolve(__dirname, '..');
}

function sidecarEntry() {
  // The sidecar ships as an extraResource beside the asar so it can be spawned
  // as a plain Node script; an asar path would not survive as a child cwd/argv.
  if (!app.isPackaged && process.env.SIDECAR_ENTRY) return process.env.SIDECAR_ENTRY;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sidecar/dist/sidecar.mjs')
    : path.join(appRoot(), 'sidecar/dist/sidecar.mjs');
}

function canvasRuntimeDir() {
  // The design compiler's esbuild, Tailwind, PostCSS and React ship beside the
  // sidecar bundle (electron-builder.config.cjs). A checkout stages no runtime,
  // so the sidecar keeps resolving them from its own node_modules.
  return app.isPackaged ? path.join(process.resourcesPath, 'sidecar/canvas-runtime') : undefined;
}

function sidecarCwd() {
  return app.isPackaged ? process.resourcesPath : appRoot();
}

function readBuildMetadata() {
  if (!app.isPackaged) {
    return {
      sentryDsn: process.env.SENTRY_DSN || '',
      sparkleFeedUrl: process.env.SPARKLE_FEED_URL || '',
      updateInstallMode: 'sparkle',
      datadog: readDatadogMetadata(process.env),
    };
  }
  try {
    const metadata = require(path.join(app.getAppPath(), 'package.json'));
    return {
      sentryDsn: typeof metadata.sentryDsn === 'string' ? metadata.sentryDsn : '',
      sparkleFeedUrl: typeof metadata.sparkleFeedUrl === 'string' ? metadata.sparkleFeedUrl : '',
      updateInstallMode: metadata.updateInstallMode === 'automatic' ? 'automatic' : 'sparkle',
      datadog: readDatadogMetadata(metadata.datadog || {}),
    };
  } catch {
    return {
      sentryDsn: '',
      sparkleFeedUrl: '',
      updateInstallMode: 'sparkle',
      datadog: readDatadogMetadata({}),
    };
  }
}

// Datadog RUM ships an application id and a *client* token. Both are meant to
// be public in a client build; the Datadog API key is a CI-only secret and is
// never read here or embedded in the app.
function readDatadogMetadata(source) {
  const read = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  return {
    applicationId: read('DATADOG_APPLICATION_ID') || read('applicationId'),
    clientToken: read('DATADOG_CLIENT_TOKEN') || read('clientToken'),
    site: read('DATADOG_SITE') || read('site'),
    distributionChannel:
      read('DROIDEX_DISTRIBUTION_CHANNEL') || read('distributionChannel') || 'local',
  };
}

module.exports = { appRoot, sidecarEntry, canvasRuntimeDir, sidecarCwd, readBuildMetadata };
