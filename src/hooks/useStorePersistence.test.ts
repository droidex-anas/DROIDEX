import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPersistedUiState } from './persistedUiPreferences';
import { normalizeDiffStyle } from './persistedThemePreferences';
import { persistStoreChanges } from './storePersistence';
import { initialState, reducer } from './useStore';
import {
  applyFactoryCompactionDefaults,
  compactionSettingsSnapshot,
  loadCompactionTokenLimitPerModel,
} from '../lib/compactionSettings';
import { withLocalStorageMap } from '../test/localStorage';

test('a commit saves only the persisted fields it changed', () => {
  const storage = new Map<string, string>();
  withLocalStorageMap(storage, () => {
    persistStoreChanges(initialState, initialState);
    assert.equal(storage.size, 0);
    const next = reducer(initialState, { type: 'SET_THEME', theme: { appIconMode: 'dark' } });
    persistStoreChanges(initialState, next);
    assert.deepEqual([...storage.keys()], ['droid-theme']);
    assert.equal(JSON.parse(storage.get('droid-theme') ?? '{}').appIconMode, 'dark');
  });
});

test('normalizeDiffStyle accepts current styles and rejects invalid values', () => {
  assert.equal(normalizeDiffStyle('soft'), 'soft');
  assert.equal(normalizeDiffStyle('focused'), 'focused');
  assert.equal(normalizeDiffStyle('unknown'), 'soft');
});

test('loadPersistedUiState sanitizes persisted shell fields', () => {
  withLocalStorage(
    JSON.stringify({
      activeAppSessionId: 'm1',
      rightPanelOpen: false,
      sidebarCollapsed: true,
      specMode: true,
      missionControlMode: false,
      selectedChild: {
        parentAppSessionId: 'm1',
        childSessionId: 'stale-child',
      },
      utilityPanels: {
        m1: {
          open: true,
          activeTabId: 'terminal-1',
          tabs: [
            { id: 'review', tool: 'review', label: 'Review' },
            {
              id: 'terminal-1',
              tool: 'terminal',
              label: 'Terminal',
              terminalId: 'pty-1',
            },
          ],
        },
      },
      browsers: {
        'chat-1': {
          browserSessionId: 'browser-chat-1',
          appSessionId: 'chat-1',
          url: 'http://127.0.0.1:17777/',
          title: 'Local app',
          viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
          viewportMode: 'fit',
          scroll: { x: 3, y: 7 },
          refs: [{ stale: true }],
          agentCursor: { x: 1, y: 2 },
          screenshotPath: '/tmp/old.png',
        },
        bad: { url: 'https://example.com' },
      },
      selectedFeatureId: 'f1',
      settingsOpen: true,
      mainView: 'pull-requests',
      prWorkspaceCwd: '/repo',
      prWorkspaceNumber: 42,
    }),
    () => {
      assert.deepEqual(loadPersistedUiState(), {
        activeAppSessionId: 'm1',
        rightPanelOpen: false,
        sidebarCollapsed: true,
        specMode: true,
        missionControlMode: false,
        utilityPanels: {
          m1: {
            open: true,
            activeTabId: 'review',
            tabs: [{ id: 'review', tool: 'review', label: 'Review' }],
          },
        },
        browsers: {
          'chat-1': {
            browserSessionId: 'browser-chat-1',
            appSessionId: 'chat-1',
            url: 'http://127.0.0.1:17777/',
            title: 'Local app',
            viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
            viewportMode: 'fit',
            scroll: { x: 3, y: 7 },
            refs: [],
          },
        },
        selectedFeatureId: 'f1',
        mainView: 'pull-requests',
        prWorkspaceCwd: '/repo',
        prWorkspaceNumber: 42,
        prBacklogIds: [],
      });
    },
  );
});

test('loadPersistedUiState drops invalid pull request workspace fields', () => {
  // [stored state, field, restored value]
  const cases: Array<
    [Record<string, unknown>, 'mainView' | 'prWorkspaceCwd' | 'prWorkspaceNumber', unknown]
  > = [
    [{ mainView: 'nope' }, 'mainView', undefined],
    [{ prWorkspaceCwd: 12 }, 'prWorkspaceCwd', undefined],
    [{ prWorkspaceCwd: '/repo', prWorkspaceNumber: 0 }, 'prWorkspaceNumber', undefined],
    [{ prWorkspaceCwd: '/repo', prWorkspaceNumber: 1.5 }, 'prWorkspaceNumber', undefined],
    [{ prWorkspaceCwd: '/repo', prWorkspaceNumber: '3' }, 'prWorkspaceNumber', undefined],
    // Without the repository it was selected in, a restored number would point at
    // whichever pull request happens to share it in the fallback repository.
    [{ prWorkspaceNumber: 3 }, 'prWorkspaceNumber', undefined],
  ];
  for (const [stored, field, restored] of cases) {
    withLocalStorage(JSON.stringify(stored), () => {
      assert.equal(loadPersistedUiState()[field], restored, JSON.stringify(stored));
    });
  }
  withLocalStorage(
    JSON.stringify({ prWorkspaceCwd: '/repo', prBacklogIds: [' acme/app#1 ', 'acme/app#1', 4] }),
    () => {
      assert.deepEqual(loadPersistedUiState().prBacklogIds, ['acme/app#1']);
    },
  );
});

test('factory defaults do not restore a cleared global or per-model compaction limit', () => {
  const cleared = { compactionTokenLimit: undefined, compactionTokenLimitPerModel: {} };
  const cases: Array<
    [Record<string, string>, Parameters<typeof applyFactoryCompactionDefaults>[1]]
  > = [
    [
      {
        'droid-compaction-token-limit-per-model': '{}',
        'droid-compaction-token-limit-per-model-configured': '1',
      },
      { compactionTokenLimitPerModel: { 'model-a': 100_000 } },
    ],
    [{ 'droid-compaction-token-limit-configured': '1' }, { compactionTokenLimit: 100_000 }],
  ];
  for (const [storage, defaults] of cases) {
    withLocalStorageMap(storage, () => {
      assert.deepEqual(applyFactoryCompactionDefaults(cleared, defaults), cleared);
    });
  }
});

test('compaction settings snapshots distinguish cold startup from explicit clears', () => {
  withLocalStorageMap({}, () => {
    assert.deepEqual(
      compactionSettingsSnapshot({
        compactionTokenLimit: undefined,
        compactionTokenLimitPerModel: {},
      }),
      {},
    );
  });

  withLocalStorageMap(
    {
      'droid-compaction-token-limit-configured': '1',
      'droid-compaction-token-limit-per-model': '{}',
      'droid-compaction-token-limit-per-model-configured': '1',
    },
    () => {
      assert.deepEqual(
        compactionSettingsSnapshot({
          compactionTokenLimit: undefined,
          compactionTokenLimitPerModel: {},
        }),
        { compactionTokenLimit: null, compactionTokenLimitPerModel: {} },
      );
    },
  );
});

test('factory defaults seed empty settings but never turn into an explicit UI override', () => {
  // The Factory-defaults seed writes the value keys for display, but without
  // the user-configured markers the snapshot must stay empty: the sidecar
  // keeps following the session's own limit and the CLI file instead of a
  // frozen first-seen seed.
  const storage = new Map<string, string>();
  withLocalStorageMap(storage, () => {
    const seeded = applyFactoryCompactionDefaults(
      { compactionTokenLimit: undefined, compactionTokenLimitPerModel: {} },
      { compactionTokenLimit: 200_000, compactionTokenLimitPerModel: { 'model-a': 100_000 } },
    );
    assert.deepEqual(seeded, {
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'model-a': 100_000 },
    });
    assert.equal(storage.get('droid-compaction-token-limit'), '200000');
    assert.equal(storage.get('droid-compaction-token-limit-per-model'), '{"model-a":100000}');
    assert.deepEqual(compactionSettingsSnapshot(seeded), {});
    // A later CLI-file change keeps flowing through instead of the first seed.
    assert.deepEqual(applyFactoryCompactionDefaults(seeded, { compactionTokenLimit: 300_000 }), {
      compactionTokenLimit: 300_000,
      compactionTokenLimitPerModel: {},
    });
    // Reloading a display-only seed must leave its marker unchanged.
    loadCompactionTokenLimitPerModel();
    assert.equal(storage.get('droid-compaction-token-limit-per-model-configured'), '0');
    assert.deepEqual(compactionSettingsSnapshot(seeded), {});
  });
});

function withLocalStorage(value: string, fn: () => void): void {
  withLocalStorageMap({ 'droid-ui-state-v2': value }, fn);
}
