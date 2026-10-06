import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authenticateGithubCli,
  cancelGithubSetup,
  getGithubAvailability,
  installGithubCli,
  isGithubAuthCodeCopied,
  onGithubAuthCode,
} from './github.js';
import type { GithubAvailability, GithubSetupResult } from '../types/vcs.js';

test('copy acknowledgement belongs only to the code that was copied', () => {
  assert.equal(isGithubAuthCodeCopied('ABCD-7HJK', 'ABCD-7HJK'), true);
  assert.equal(isGithubAuthCodeCopied('WXYZ-1234', 'ABCD-7HJK'), false);
  assert.equal(isGithubAuthCodeCopied(null, 'ABCD-7HJK'), false);
});

function setDesktopApi(api: Record<string, unknown>) {
  Object.defineProperty(globalThis, 'window', {
    value: { droidControl: api },
    configurable: true,
    writable: true,
  });
}

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

test('GitHub setup wrappers preserve closed desktop results', async () => {
  const expectedAvailability: GithubAvailability = {
    installed: false,
    authenticated: false,
    installMethod: 'homebrew',
  };
  setDesktopApi({
    githubAvailable: async () => expectedAvailability,
    githubInstall: async () => ({ ok: true }),
    githubAuthenticate: async () => ({ ok: true }),
    githubCancelSetup: async () => ({ ok: true }),
    onGithubAuthCode: () => () => undefined,
  });
  assert.deepEqual(await getGithubAvailability(), expectedAvailability);
  assert.deepEqual(await installGithubCli(), { ok: true });
  assert.deepEqual(await authenticateGithubCli(), { ok: true });
  await cancelGithubSetup();
});

test('GitHub setup wrapper exposes only the validated device-code string', () => {
  let desktopHandler: ((payload: unknown) => void) | undefined;
  let unsubscribed = false;
  setDesktopApi({
    onGithubAuthCode: (handler: (payload: unknown) => void) => {
      desktopHandler = handler;
      return () => {
        unsubscribed = true;
      };
    },
  });
  const received: string[] = [];

  const unsubscribe = onGithubAuthCode((code) => received.push(code));
  desktopHandler?.(null);
  desktopHandler?.({});
  desktopHandler?.({ code: 42 });
  desktopHandler?.({ code: 'not-a-device-code' });
  desktopHandler?.({ code: 'ABCD-7HJK' });
  assert.deepEqual(received, ['ABCD-7HJK']);

  unsubscribe();
  assert.equal(unsubscribed, true);
});

test('GitHub setup wrappers return fixed transport failures', async () => {
  setDesktopApi({
    githubAvailable: async () => {
      throw new Error('private availability details');
    },
    githubInstall: async () => {
      throw new Error('private install details');
    },
    githubAuthenticate: async () => {
      throw new Error('private auth details');
    },
  });
  assert.deepEqual(await getGithubAvailability(), {
    installed: false,
    authenticated: false,
    installMethod: 'manual',
  });
  assert.deepEqual(await installGithubCli(), {
    ok: false,
    reason: 'install_failed',
    message: 'DROIDEX could not start GitHub CLI installation.',
  });
  assert.deepEqual(await authenticateGithubCli(), {
    ok: false,
    reason: 'auth_failed',
    message: 'DROIDEX could not start GitHub sign-in.',
  });
});

test('GitHub setup operations explain when desktop integration is unavailable', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  });
  const expected: GithubSetupResult = {
    ok: false,
    reason: 'not_desktop',
    message: 'GitHub setup is available in the desktop app.',
  };

  assert.deepEqual(await installGithubCli(), expected);
  assert.deepEqual(await authenticateGithubCli(), expected);
});
