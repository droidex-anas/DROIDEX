const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const {
  loadBooleanPreference,
  saveBooleanPreference,
  writeJsonFile,
} = require('./preferenceFile.cjs');

// Anonymous installation counting.
//
// The only identifier is a random UUID minted on the first launch that reaches
// this module and kept in userData, so it survives restarts and updates. It is
// never derived from hardware, account, username, or network identity: two
// machines that install the same build share nothing, and the same machine
// reinstalling over a preserved userData keeps counting as one installation.
//
// Telemetry is reported by the renderer through Datadog RUM. This module owns
// the parts the renderer must not decide for itself: whether reporting is
// allowed at all, the identifier, and the small fixed set of build facts that
// may accompany an event.

const USAGE_ANALYTICS_DEFAULT = true;
const INSTALLATION_FILENAME = 'usage-analytics.json';
const PREFERENCE_FILENAME = 'usage-analytics-preferences.json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INVALID_PREFERENCE_MESSAGE =
  'Usage analytics preference is invalid. Toggle it again in Settings.';
const OPTED_OUT_MESSAGE = 'Usage analytics was turned off during this launch.';

// Files an earlier run leaves in userData. Seeing one means an existing user
// updated into an instrumented build rather than a new installation. This build
// writes diagnostics.json itself during startup, so the check has to run before
// that: see notePriorInstall().
const EXISTING_INSTALL_MARKERS = ['diagnostics.json', 'onboarding.json', 'chats'];

const DISABLED = Object.freeze({ enabled: false });

function createUsageAnalytics(options) {
  const app = options.app;
  const config = options.config || {};
  const fileSystem = options.fs || fs;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const env = options.env || process.env;
  const exists = options.exists || existsSync;
  let installationPromise = null;
  let priorInstall = null;
  // Set the moment the user opts out, so work already under way stops instead
  // of writing the identifier back after the file has been deleted.
  let optedOut = false;
  let fileWork = Promise.resolve();

  /**
   * Runs everything that touches the installation file one after another. Opting
   * out deletes that file, and without this a write still in flight could land
   * after the delete and leave the identifier on disk.
   */
  function queueFileWork(work) {
    const done = fileWork.then(work, work);
    fileWork = done.then(ignore, ignore);
    return done;
  }

  /** Snapshot whether an earlier run left files behind. Call before anything this run writes to userData. */
  function notePriorInstall() {
    priorInstall ??= EXISTING_INSTALL_MARKERS.some((marker) =>
      exists(path.join(app.getPath('userData'), marker)),
    );
  }

  function installationFilePath() {
    return path.join(app.getPath('userData'), INSTALLATION_FILENAME);
  }

  function preferenceFilePath() {
    return path.join(app.getPath('userData'), PREFERENCE_FILENAME);
  }

  function preference() {
    return loadBooleanPreference({
      filePath: preferenceFilePath(),
      fs: fileSystem,
      fallback: USAGE_ANALYTICS_DEFAULT,
      invalidMessage: INVALID_PREFERENCE_MESSAGE,
    });
  }

  async function setEnabled(enabled) {
    if (typeof enabled !== 'boolean')
      throw new Error('Usage analytics preference must be boolean.');
    optedOut = !enabled;
    await saveBooleanPreference({ filePath: preferenceFilePath(), enabled, fs: fileSystem });
    installationPromise = null;
    if (!enabled) {
      await queueFileWork(async () => {
        try {
          await fileSystem.unlink(installationFilePath());
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      });
    }
    return { enabled };
  }

  function installation() {
    if (optedOut) return Promise.reject(new Error(OPTED_OUT_MESSAGE));
    notePriorInstall();
    installationPromise ??= queueFileWork(() => {
      if (optedOut) throw new Error(OPTED_OUT_MESSAGE);
      return loadOrCreateInstallation({
        filePath: installationFilePath(),
        priorInstall,
        randomUUID,
        fs: fileSystem,
        now: options.now,
      });
    });
    return installationPromise;
  }

  /**
   * The payload the renderer needs to start Datadog RUM, or `{ enabled: false }`
   * when this build must stay silent. Never rejects: telemetry that cannot be
   * configured is telemetry that is simply not sent.
   */
  async function bootstrap() {
    try {
      if (!app.isPackaged) return DISABLED;
      if (isOptedOutByEnvironment(env)) return DISABLED;
      if (!config.applicationId || !config.clientToken || !config.site) return DISABLED;
      if (!(await preference()).enabled) return DISABLED;
      const record = await installation();
      // The user can have opted out while the identifier was being read.
      if (optedOut) return DISABLED;
      return {
        enabled: true,
        applicationId: config.applicationId,
        clientToken: config.clientToken,
        site: config.site,
        version: app.getVersion(),
        installationId: record.installationId,
        // Until the report is recorded, every launch retries it, including launches
        // after one that minted the ID and quit before recording.
        firstLaunch: !record.firstLaunchReportedAt,
        installOrigin: record.origin,
        context: buildContext(app, config, options),
      };
    } catch (error) {
      options.logError?.('Usage analytics bootstrap skipped', error);
      return DISABLED;
    }
  }

  /**
   * Records that `install_first_launch` was handed to the SDK, so later
   * launches stop reporting it. A launch that quits before this runs leaves the
   * marker unset and the next launch reports it again.
   */
  async function markFirstLaunchReported() {
    try {
      const record = await installation();
      if (record.firstLaunchReportedAt) return { recorded: true };
      const reportedAt = (options.now?.() ?? new Date()).toISOString();
      const reported = { ...record, firstLaunchReportedAt: reportedAt };
      await queueFileWork(async () => {
        if (optedOut) throw new Error(OPTED_OUT_MESSAGE);
        await writeInstallation(fileSystem, installationFilePath(), reported);
        installationPromise = Promise.resolve(reported);
      });
      return { recorded: true };
    } catch (error) {
      options.logError?.('Usage analytics first-launch marker skipped', error);
      return { recorded: false };
    }
  }

  return { bootstrap, markFirstLaunchReported, notePriorInstall, preference, setEnabled };
}

function buildContext(app, config, options) {
  return {
    app_version: app.getVersion(),
    platform: options.platform || process.platform,
    architecture: options.arch || process.arch,
    distribution_channel: normalizeChannel(config.distributionChannel),
  };
}

/**
 * `release` is stamped only by the signed release workflow. Every other
 * packaged build — a maintainer's local `npm run dist:mac`, an unsigned
 * preview, a one-off — reports `local`, so dashboards can count real users
 * without counting the people building the app.
 */
function normalizeChannel(value) {
  return value === 'release' ? 'release' : 'local';
}

function ignore() {}

function isOptedOutByEnvironment(env) {
  const value = env.DROIDEX_DISABLE_USAGE_ANALYTICS;
  return value === '1' || value === 'true';
}

async function loadOrCreateInstallation(options) {
  try {
    const parsed = JSON.parse(await options.fs.readFile(options.filePath, 'utf8'));
    if (parsed?.version === 1 && UUID_PATTERN.test(parsed.installationId)) {
      return {
        installationId: parsed.installationId,
        origin: parsed.origin === 'existing_install' ? 'existing_install' : 'new_install',
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
        firstLaunchReportedAt:
          typeof parsed.firstLaunchReportedAt === 'string'
            ? parsed.firstLaunchReportedAt
            : undefined,
      };
    }
  } catch {
    // A missing or malformed record is replaced by a fresh installation below.
  }
  const record = {
    installationId: options.randomUUID(),
    origin: options.priorInstall ? 'existing_install' : 'new_install',
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
  await writeInstallation(options.fs, options.filePath, record);
  return record;
}

function writeInstallation(fileSystem, filePath, record) {
  const payload = {
    version: 1,
    installationId: record.installationId,
    origin: record.origin,
    createdAt: record.createdAt,
  };
  if (record.firstLaunchReportedAt) payload.firstLaunchReportedAt = record.firstLaunchReportedAt;
  return writeJsonFile(fileSystem, filePath, payload);
}

module.exports = { createUsageAnalytics };
