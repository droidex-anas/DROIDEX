const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createUsageAnalytics } = require('./usageAnalytics.cjs');

const USER_DATA = '/tmp/droidex-usage-analytics-test';

// Minimal in-memory userData. Writes go through a temporary file and a rename,
// exactly as the module does on disk.
function missing(filePath) {
  return Object.assign(new Error(`missing ${filePath}`), { code: 'ENOENT' });
}

function memoryFs(seed = {}) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: async (filePath) => {
      if (!files.has(filePath)) throw missing(filePath);
      return files.get(filePath);
    },
    stat: async (filePath) => {
      if (!files.has(filePath)) throw missing(filePath);
      return { isFile: () => true };
    },
    mkdir: async () => undefined,
    writeFile: async (filePath, contents) => {
      files.set(filePath, contents);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlink: async (filePath) => {
      if (!files.has(filePath)) throw missing(filePath);
      files.delete(filePath);
    },
  };
}

const CONFIG = {
  applicationId: 'app-id',
  clientToken: 'pub-client-token',
  site: 'datadoghq.eu',
  distributionChannel: 'release',
};

let uuidCounter = 0;
function options(overrides = {}) {
  const fs = overrides.fs ?? memoryFs();
  return {
    app: {
      getPath: () => USER_DATA,
      getVersion: () => '1.3.0',
      isPackaged: true,
      ...overrides.app,
    },
    config: overrides.config ?? CONFIG,
    fs,
    exists: (filePath) => fs.files.has(filePath),
    env: overrides.env ?? {},
    platform: 'darwin',
    arch: 'arm64',
    now: () => new Date('2026-09-20T09:00:00Z'),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  };
}

const installationPath = path.join(USER_DATA, 'usage-analytics.json');
const preferencePath = path.join(USER_DATA, 'usage-analytics-preferences.json');

test('installation id is a random UUID that survives restarts and updates', async () => {
  const fs = memoryFs();
  const first = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(first.enabled, true);
  assert.match(
    first.installationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  // A later launch is a fresh module instance reading the same userData.
  const second = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(second.installationId, first.installationId);

  const stored = JSON.parse(fs.files.get(installationPath));
  assert.equal(stored.installationId, first.installationId);
  assert.equal(stored.version, 1);
});

test('the id is not derived from device, account, or network identity', async () => {
  const fs = memoryFs();
  const analytics = createUsageAnalytics(
    options({
      fs,
      // Values that a fingerprinting implementation would reach for.
      env: { USER: 'anas', HOSTNAME: 'anas-macbook', HOME: '/Users/anas' },
    }),
  );
  const bootstrap = await analytics.bootstrap();
  const serialized = JSON.stringify(bootstrap).toLowerCase();
  for (const secret of ['anas', 'macbook', '/users/']) {
    assert.equal(serialized.includes(secret), false, `payload leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(bootstrap.context).sort(), [
    'app_version',
    'architecture',
    'distribution_channel',
    'platform',
  ]);
});

test('development builds, unconfigured builds, and the kill switch report nothing', async () => {
  const silent = [
    options({ app: { isPackaged: false } }),
    options({ config: {} }),
    options({ config: { ...CONFIG, applicationId: '' } }),
    options({ config: { ...CONFIG, clientToken: '' } }),
    options({ config: { ...CONFIG, site: '' } }),
    options({ env: { DROIDEX_DISABLE_USAGE_ANALYTICS: '1' } }),
  ];
  for (const silentOptions of silent) {
    assert.deepEqual(await createUsageAnalytics(silentOptions).bootstrap(), { enabled: false });
  }
});

test('maintainer builds report the local channel, not release', async () => {
  const analytics = createUsageAnalytics(
    options({ config: { ...CONFIG, distributionChannel: undefined } }),
  );
  const bootstrap = await analytics.bootstrap();
  assert.equal(bootstrap.context.distribution_channel, 'local');
});

test('first launch is reported once per installation, retrying until it is recorded', async () => {
  const fs = memoryFs();
  const analytics = createUsageAnalytics(options({ fs }));
  const first = await analytics.bootstrap();
  assert.equal(first.firstLaunch, true);
  assert.equal(first.installOrigin, 'new_install');
  await analytics.markFirstLaunchReported();

  const relaunch = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(relaunch.firstLaunch, false);
  assert.equal(relaunch.installationId, first.installationId);

  // A launch that quits before recording its report retries on the next one.
  const unreported = memoryFs();
  const minted = await createUsageAnalytics(options({ fs: unreported })).bootstrap();
  const retried = await createUsageAnalytics(options({ fs: unreported })).bootstrap();
  assert.equal(retried.installationId, minted.installationId);
  assert.equal(retried.firstLaunch, true);
});

test('only files from before this run tag an update into an instrumented build as existing', async () => {
  // Older builds already wrote these into userData.
  const fs = memoryFs({ [path.join(USER_DATA, 'diagnostics.json')]: '{}' });
  const bootstrap = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(bootstrap.firstLaunch, true);
  assert.equal(bootstrap.installOrigin, 'existing_install');

  // Files this run writes at startup (diagnostics' identity) do not count.
  const freshFs = memoryFs();
  const fresh = createUsageAnalytics(options({ fs: freshFs }));
  fresh.notePriorInstall();
  freshFs.files.set(path.join(USER_DATA, 'diagnostics.json'), '{}');
  assert.equal((await fresh.bootstrap()).installOrigin, 'new_install');
});

test('opting out stops reporting and deletes the stored id', async () => {
  const fs = memoryFs();
  const analytics = createUsageAnalytics(options({ fs }));
  await analytics.bootstrap();
  assert.equal(fs.files.has(installationPath), true);

  assert.deepEqual(await analytics.setEnabled(false), { enabled: false });
  assert.equal(fs.files.has(installationPath), false);
  assert.deepEqual(await analytics.bootstrap(), { enabled: false });
  assert.equal(JSON.parse(fs.files.get(preferencePath)).enabled, false);

  await analytics.setEnabled(true);
  assert.equal((await analytics.bootstrap()).enabled, true);
});

test('unreadable state never throws at startup', async () => {
  const failing = {
    ...memoryFs(),
    readFile: async () => {
      throw new Error('disk is on fire');
    },
    writeFile: async () => {
      throw new Error('disk is on fire');
    },
  };
  const analytics = createUsageAnalytics(options({ fs: failing }));
  assert.deepEqual(await analytics.bootstrap(), { enabled: false });
  assert.deepEqual(await analytics.markFirstLaunchReported(), { recorded: false });
});

test('opting out while the id is being written leaves nothing behind', async () => {
  const fs = memoryFs();
  const rename = fs.rename;
  // Holds the installation write open until the opt-out overlaps it.
  let releaseWrite = () => undefined;
  const writeHeld = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  fs.rename = async (from, to) => {
    await writeHeld;
    return rename(from, to);
  };
  const analytics = createUsageAnalytics(options({ fs }));

  const launch = analytics.bootstrap();
  for (let tick = 0; tick < 3; tick += 1) await new Promise(setImmediate);
  const optingOut = analytics.setEnabled(false);
  releaseWrite();
  await optingOut;

  assert.equal(fs.files.has(installationPath), false);
  assert.deepEqual(await launch, { enabled: false });
  assert.equal(fs.files.has(installationPath), false);
});

test('recording a first launch after an opt-out does not write the id back', async () => {
  const fs = memoryFs();
  const analytics = createUsageAnalytics(options({ fs }));
  await analytics.bootstrap();

  await analytics.setEnabled(false);
  assert.deepEqual(await analytics.markFirstLaunchReported(), { recorded: false });
  assert.equal(fs.files.has(installationPath), false);
});
