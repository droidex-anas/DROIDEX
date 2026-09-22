const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createUsageAnalytics } = require('./usageAnalytics.cjs');

const USER_DATA = '/tmp/droidex-usage-analytics-test';

// Minimal in-memory userData. Writes go through a temporary file and a rename,
// exactly as the module does on disk.
function memoryFs(seed = {}) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: async (filePath) => {
      if (!files.has(filePath)) {
        const error = new Error(`missing ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath);
    },
    stat: async (filePath) => {
      if (!files.has(filePath)) {
        const error = new Error(`missing ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }
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
      if (!files.has(filePath)) {
        const error = new Error(`missing ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }
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

test('development and test builds report nothing', async () => {
  const analytics = createUsageAnalytics(options({ app: { isPackaged: false } }));
  assert.deepEqual(await analytics.bootstrap(), { enabled: false });
});

test('a packaged build with no Datadog configuration reports nothing', async () => {
  for (const config of [
    {},
    { ...CONFIG, applicationId: '' },
    { ...CONFIG, clientToken: '' },
    { ...CONFIG, site: '' },
  ]) {
    const analytics = createUsageAnalytics(options({ config }));
    assert.deepEqual(await analytics.bootstrap(), { enabled: false });
  }
});

test('the environment kill switch silences a packaged build', async () => {
  const analytics = createUsageAnalytics(
    options({ env: { DROIDEX_DISABLE_USAGE_ANALYTICS: '1' } }),
  );
  assert.deepEqual(await analytics.bootstrap(), { enabled: false });
});

test('maintainer builds report the local channel, not release', async () => {
  const analytics = createUsageAnalytics(
    options({ config: { ...CONFIG, distributionChannel: undefined } }),
  );
  const bootstrap = await analytics.bootstrap();
  assert.equal(bootstrap.context.distribution_channel, 'local');
});

test('first launch is reported once per installation', async () => {
  const fs = memoryFs();
  const analytics = createUsageAnalytics(options({ fs }));
  const first = await analytics.bootstrap();
  assert.equal(first.firstLaunch, true);
  assert.equal(first.installOrigin, 'new_install');
  await analytics.markFirstLaunchReported();

  const relaunch = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(relaunch.firstLaunch, false);
  assert.equal(relaunch.installationId, first.installationId);
});

test('a first launch that quits before recording its report retries next launch', async () => {
  const fs = memoryFs();
  const first = await createUsageAnalytics(options({ fs })).bootstrap();
  // No markFirstLaunchReported: the app quit after minting the ID.
  const relaunch = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(relaunch.installationId, first.installationId);
  assert.equal(relaunch.firstLaunch, true);
});

test('an existing user updating into an instrumented build is tagged as such', async () => {
  // Older builds already wrote these into userData.
  const fs = memoryFs({ [path.join(USER_DATA, 'diagnostics.json')]: '{}' });
  const bootstrap = await createUsageAnalytics(options({ fs })).bootstrap();
  assert.equal(bootstrap.firstLaunch, true);
  assert.equal(bootstrap.installOrigin, 'existing_install');
});

test('files this run writes at startup do not make a new install look existing', async () => {
  const fs = memoryFs();
  const analytics = createUsageAnalytics(options({ fs }));
  analytics.notePriorInstall();
  // Diagnostics writes its identity file during startup, before any window.
  fs.files.set(path.join(USER_DATA, 'diagnostics.json'), '{}');
  assert.equal((await analytics.bootstrap()).installOrigin, 'new_install');
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
