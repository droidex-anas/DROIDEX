import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetUsageAnalyticsForTest,
  buildRumConfig,
  normalizeBootstrap,
  sanitizeRumEvent,
  setUsageAnalyticsPreference,
  startUsageAnalytics,
} from './usageAnalytics';

const CONTEXT = {
  app_version: '1.3.0',
  platform: 'darwin',
  architecture: 'arm64',
  distribution_channel: 'release',
};

const ENABLED = {
  enabled: true,
  applicationId: 'app-id',
  clientToken: 'pub-client-token',
  site: 'datadoghq.eu',
  version: '1.3.0',
  installationId: '00000000-0000-4000-8000-000000000001',
  firstLaunch: false,
  installOrigin: 'new_install',
  context: CONTEXT,
};

interface RecordedAction {
  name: string;
  context?: Record<string, unknown>;
}

function fakeRum() {
  const actions: RecordedAction[] = [];
  let config: Record<string, unknown> = {};
  let user: { id: string } | null = null;
  let stopped = false;
  return {
    api: {
      init: (value: Record<string, unknown>) => {
        config = value;
      },
      setUser: (value: { id: string }) => {
        user = value;
      },
      startView: () => undefined,
      addAction: (name: string, context?: Record<string, unknown>) => {
        actions.push({ name, context });
      },
      stopSession: () => {
        stopped = true;
      },
    },
    stopped: () => stopped,
    actions,
    config: () => config,
    user: () => user,
  };
}

test('a packaged launch identifies the installation and reports app_opened', async () => {
  __resetUsageAnalyticsForTest();
  const rum = fakeRum();
  const outcome = await startUsageAnalytics({
    bootstrap: async () => ENABLED,
    loadRum: async () => rum.api,
  });

  assert.equal(outcome, 'started');
  assert.deepEqual(rum.user(), { id: ENABLED.installationId });
  assert.deepEqual(
    rum.actions.map((action) => action.name),
    ['app_opened'],
  );
  assert.deepEqual(rum.actions[0].context, CONTEXT);
});

test('a disabled build loads no SDK and sends nothing', async () => {
  __resetUsageAnalyticsForTest();
  let loaded = false;
  const outcome = await startUsageAnalytics({
    bootstrap: async () => ({ enabled: false }),
    loadRum: async () => {
      loaded = true;
      throw new Error('should not load');
    },
  });
  assert.equal(outcome, 'disabled');
  assert.equal(loaded, false);
});

test('install_first_launch is reported once and then acknowledged', async () => {
  __resetUsageAnalyticsForTest();
  const rum = fakeRum();
  let acknowledged = 0;
  await startUsageAnalytics({
    bootstrap: async () => ({ ...ENABLED, firstLaunch: true }),
    reportFirstLaunch: async () => {
      acknowledged += 1;
      return { recorded: true };
    },
    loadRum: async () => rum.api,
  });

  assert.deepEqual(
    rum.actions.map((action) => action.name),
    ['app_opened', 'install_first_launch'],
  );
  assert.equal(acknowledged, 1);
  assert.equal(rum.actions[1].context?.install_origin, 'new_install');

  // A relaunch of the same installation no longer sets firstLaunch.
  __resetUsageAnalyticsForTest();
  const relaunch = fakeRum();
  await startUsageAnalytics({
    bootstrap: async () => ENABLED,
    reportFirstLaunch: async () => {
      acknowledged += 1;
      return { recorded: true };
    },
    loadRum: async () => relaunch.api,
  });
  assert.deepEqual(
    relaunch.actions.map((action) => action.name),
    ['app_opened'],
  );
  assert.equal(acknowledged, 1);
});

test('no personal or user-generated data reaches an event payload', async () => {
  __resetUsageAnalyticsForTest();
  const rum = fakeRum();
  await startUsageAnalytics({
    bootstrap: async () => ({ ...ENABLED, firstLaunch: true }),
    reportFirstLaunch: async () => ({ recorded: true }),
    loadRum: async () => rum.api,
  });

  const allowed = new Set([
    'app_version',
    'platform',
    'architecture',
    'distribution_channel',
    'install_origin',
  ]);
  for (const action of rum.actions) {
    for (const key of Object.keys(action.context ?? {})) {
      assert.equal(allowed.has(key), true, `unexpected property ${key}`);
    }
  }

  const serialized = JSON.stringify({
    config: rum.config(),
    actions: rum.actions,
    user: rum.user(),
  });
  for (const forbidden of ['@', 'Users/', '/home/', 'prompt', 'repository', '.git']) {
    assert.equal(serialized.includes(forbidden), false, `payload leaked ${forbidden}`);
  }
});

test('the SDK is configured for full sampling, no replay, and masked input', async () => {
  const config = buildRumConfig(normalizeBootstrap(ENABLED)!);
  assert.equal(config.service, 'droidex');
  assert.equal(config.env, 'production');
  assert.equal(config.version, '1.3.0');
  assert.equal(config.sessionSampleRate, 100);
  assert.equal(config.sessionReplaySampleRate, 0);
  assert.equal(config.defaultPrivacyLevel, 'mask');
  assert.equal(config.trackUserInteractions, false);
  assert.equal(config.trackResources, false);
  assert.equal(config.trackLongTasks, false);
  assert.equal(config.trackViewsManually, true);
  // file:// renderers have no cookies; without this the SDK cannot keep a session.
  assert.equal(config.sessionPersistence, 'local-storage');
  // usr.id is the installation id and the only identifier we want.
  assert.equal(config.trackAnonymousUser, false);
});

test('local file URLs never leave the app', () => {
  const event: Record<string, unknown> = {
    type: 'view',
    view: {
      url: 'file:///Users/someone/Projects/secret-repo/index.html',
      referrer: 'file:///Users/someone/Projects/secret-repo/',
      name: '/Users/someone/Projects/secret-repo',
    },
    context: { app_version: '1.3.0', cwd: '/Users/someone/Projects/secret-repo' },
  };
  assert.equal(sanitizeRumEvent(event), true);
  assert.deepEqual(event.view, {
    url: 'app://droidex',
    referrer: 'app://droidex',
    name: 'app',
  });
  // The event's own attributes survive; anything not on the allowlist does not.
  assert.deepEqual(event.context, { app_version: '1.3.0' });

  // Event types DROIDEX does not report are discarded outright.
  assert.equal(sanitizeRumEvent({ type: 'resource', resource: { url: 'file:///x' } }), false);
  assert.equal(sanitizeRumEvent(null), false);
});

test('an incomplete bootstrap payload is treated as disabled', () => {
  assert.equal(normalizeBootstrap(null), null);
  assert.equal(normalizeBootstrap({ enabled: false }), null);
  assert.equal(normalizeBootstrap({ ...ENABLED, clientToken: '' }), null);
  assert.equal(normalizeBootstrap({ ...ENABLED, installationId: '' }), null);
  assert.equal(normalizeBootstrap({ ...ENABLED, context: undefined }), null);
});

test('a failing SDK load never propagates', async () => {
  __resetUsageAnalyticsForTest();
  const outcome = await startUsageAnalytics({
    bootstrap: async () => ENABLED,
    loadRum: async () => {
      throw new Error('network is unavailable');
    },
  });
  assert.equal(outcome, 'failed');
});

test('opting out stops a running client for the rest of the launch', async () => {
  __resetUsageAnalyticsForTest();
  const rum = fakeRum();
  await startUsageAnalytics({ bootstrap: async () => ENABLED, loadRum: async () => rum.api });
  Reflect.set(globalThis, 'window', {
    droidControl: { setUsageAnalytics: async () => ({ enabled: false }) },
  });
  try {
    await setUsageAnalyticsPreference(false);
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
  assert.equal(rum.stopped(), true);
  assert.equal(sanitizeRumEvent({ type: 'action', context: {} }), false);
  __resetUsageAnalyticsForTest();
});
