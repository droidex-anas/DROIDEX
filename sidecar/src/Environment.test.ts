import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './childEnv.js';
import {
  availableChannels,
  hasCliLogin,
  resolveDroidPath,
  windowsExecutableExtensions,
  wrapDroidInvocation,
} from './Environment.js';

/** Runs `body` with `process.env[name]` set to `value`, restoring it after. */
function withEnv(name: string, value: string, body: () => void): void {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('availableChannels lists detected installers in priority order, per platform', () => {
  const all = { brew: true, npm: true, curl: true, pnpm: false };
  assert.deepEqual(availableChannels(all, 'darwin'), ['script', 'brew', 'npm']);
  assert.deepEqual(
    availableChannels({ brew: false, npm: true, curl: false, pnpm: false }, 'darwin'),
    ['npm'],
  );
  assert.deepEqual(
    availableChannels({ brew: false, npm: false, curl: false, pnpm: false }, 'darwin'),
    [],
  );
  // Brew is a mac-only cask, and the shell script has no Windows channel.
  assert.deepEqual(availableChannels(all, 'linux'), ['script', 'npm']);
  assert.deepEqual(availableChannels({ ...all, brew: false }, 'win32'), ['npm']);
});

test('resolveDroidPath trusts an executable DROID_PATH and ignores a stale one', () => {
  withEnv('DROID_PATH', process.execPath, () => {
    assert.equal(resolveDroidPath(), process.execPath);
  });
  withEnv('DROID_PATH', '/nonexistent/droid-binary-xyz', () => {
    assert.notEqual(resolveDroidPath(), '/nonexistent/droid-binary-xyz');
  });
});

test('Windows launches route a .cmd shim through cmd.exe and keep default PATHEXT; POSIX spawns directly', () => {
  const shim = 'C\\\\npm\\\\droid.cmd';
  withEnv('ComSpec', 'C\\\\Windows\\\\System32\\\\cmd.exe', () => {
    assert.deepEqual(wrapDroidInvocation(shim, ['exec'], 'win32'), {
      execPath: 'C\\\\Windows\\\\System32\\\\cmd.exe',
      execArgs: ['/c', shim, 'exec'],
    });
  });
  withEnv('ComSpec', '', () => {
    assert.deepEqual(wrapDroidInvocation(shim, ['exec'], 'win32'), {
      execPath: 'cmd.exe',
      execArgs: ['/c', shim, 'exec'],
    });
  });
  assert.deepEqual(wrapDroidInvocation('/usr/local/bin/droid', ['exec'], 'darwin'), {
    execPath: '/usr/local/bin/droid',
    execArgs: ['exec'],
  });
  assert.deepEqual(windowsExecutableExtensions(''), ['.COM', '.EXE', '.BAT', '.CMD']);
  assert.deepEqual(windowsExecutableExtensions('.EXE;.CMD'), ['.EXE', '.CMD']);
});

test('hasCliLogin detects the current credential marker, not the retired auth.v2.file', () => {
  for (const [marker, loggedIn] of [
    ['auth.v2.key', true],
    ['auth.v2.file', false],
  ] as const) {
    const authDir = mkdtempSync(join(tmpdir(), 'droid-auth-'));
    try {
      writeFileSync(join(authDir, marker), '');
      assert.equal(hasCliLogin(authDir), loggedIn);
    } finally {
      rmSync(authDir, { recursive: true, force: true });
    }
  }
});

test('childEnv drops the app-private variables and keeps the user shell', () => {
  const env = childEnv({
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    SHELL: '/bin/zsh',
    LANG: 'en_US.UTF-8',
    DROID_PATH: '/usr/local/bin/droid',
    FACTORY_API_KEY: 'user-key',
    DROIDEX_USER_DATA_DIR: '/profile',
    DROIDEX_HISTORY_DIR: '/profile/history',
    BRIDGE_PORT: '1234',
    BRIDGE_TOKEN: 'secret',
    BROWSER_ASSET_TOKEN: 'secret',
    CANVAS_ASSET_SECRET: 'synthetic-secret',
    BRIDGE_EXIT_ON_STDIN_CLOSE: '1',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_START_URL: 'http://localhost:5173',
    SIDECAR_ENTRY: '/sidecar/dist/index.js',
    UNSET: undefined,
  });

  assert.deepEqual(env, {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    SHELL: '/bin/zsh',
    LANG: 'en_US.UTF-8',
    DROID_PATH: '/usr/local/bin/droid',
    FACTORY_API_KEY: 'user-key',
  });
});
