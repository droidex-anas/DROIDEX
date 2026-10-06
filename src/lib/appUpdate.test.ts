import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppUpdateButtonView } from '../components/SidebarAppUpdateButton';
import {
  checkForAppUpdateAutomatically,
  consumeDeferredAppUpdate,
  isAppUpdateInstalling,
  prepareAppUpdateRequest,
  startAppUpdate,
  startAutomaticAppUpdateChecks,
} from './appUpdate';
import { createSession } from './commands';

const DEFERRED_KEY = 'droidex.app-update.deferred';

const update = {
  current: '1.1.3',
  latest: '1.1.4',
  updateAvailable: true,
  arch: 'arm64',
  platform: 'darwin',
  installMode: 'automatic' as const,
};

function updateStorage(entries: Array<[string, string]> = []) {
  const values = new Map(entries);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  return { values, storage };
}

test('automatic update checks start before CLI environment detection and repeat while enabled', () => {
  let checks = 0;
  let scheduled: (() => void) | undefined;
  let intervalMs = 0;
  let cancelled = 0;
  const stop = startAutomaticAppUpdateChecks(
    () => {
      checks += 1;
    },
    (callback, interval) => {
      scheduled = callback;
      intervalMs = interval;
      return 17;
    },
    (handle) => {
      cancelled = handle;
    },
  );

  assert.equal(checks, 1);
  assert.equal(intervalMs, 4 * 60 * 60 * 1_000);
  scheduled?.();
  assert.equal(checks, 2);
  stop();
  assert.equal(cancelled, 17);
});

test('waiting on an update during active work carries that approval to the next launch check', () => {
  const { storage } = updateStorage();

  assert.equal(
    prepareAppUpdateRequest(true, () => false, storage),
    false,
  );
  assert.equal(consumeDeferredAppUpdate(false, storage), false);
  assert.equal(consumeDeferredAppUpdate(true, storage), true);
  assert.equal(consumeDeferredAppUpdate(true, storage), false);
});

test('an idle app installs immediately without showing a restart warning', () => {
  const { values, storage } = updateStorage([[DEFERRED_KEY, '1']]);
  let prompted = false;

  assert.equal(
    prepareAppUpdateRequest(
      false,
      () => {
        prompted = true;
        return false;
      },
      storage,
    ),
    true,
  );
  assert.equal(prompted, false);
  assert.equal(values.has(DEFERRED_KEY), false);
});

test('only the launch check may resume a deferred update', async () => {
  const { values, storage } = updateStorage([[DEFERRED_KEY, '1']]);
  let installs = 0;
  const check = async () => update;
  const install = async () => {
    installs += 1;
  };

  await checkForAppUpdateAutomatically(false, check, install, storage);
  assert.equal(installs, 0);
  assert.equal(values.get(DEFERRED_KEY), '1');
  await checkForAppUpdateAutomatically(true, check, install, storage);
  assert.equal(installs, 1);
  assert.equal(values.has(DEFERRED_KEY), false);
});

test('new agent work is blocked for the full automatic update transaction', async () => {
  const previousWindow = globalThis.window;
  let finishDownload: (() => void) | undefined;
  const download = new Promise<null>((resolve) => {
    finishDownload = () => {
      resolve(null);
    };
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { droidControl: { downloadAppUpdate: () => download } },
  });

  try {
    const installing = startAppUpdate(update);
    assert.equal(isAppUpdateInstalling(), true);
    assert.throws(
      () =>
        createSession({
          clientRef: 'blocked',
          title: 'Blocked during update',
          goal: 'Do not send',
          sessionPurpose: 'chat',
          autonomy: 'off',
        }),
      /new agent work is paused until restart/,
    );
    finishDownload?.();
    await installing;
    assert.equal(isAppUpdateInstalling(), false);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('sidebar download button only appears for a discovered update', () => {
  const render = (latest: string | null) =>
    renderToStaticMarkup(
      createElement(AppUpdateButtonView, { latest, downloading: false, onStart: () => undefined }),
    );

  assert.equal(render(null), '');
  const html = render('1.1.4');
  assert.match(html, /Review DROIDEX 1\.1\.4 update/);
  assert.match(html, /<button/);
  assert.match(html, /data-icon="download"/);
});
