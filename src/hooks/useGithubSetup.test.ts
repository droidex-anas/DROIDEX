import assert from 'node:assert/strict';
import test from 'node:test';

import type { GithubAvailability } from '../types/vcs.js';
import {
  githubSetupReducer,
  initialGithubSetupState,
  primaryActionFor,
  shouldRefreshGithubOnVisibility,
  shouldResetGithubSetupForRepository,
} from './useGithubSetup.js';

const homebrewMissing: GithubAvailability = {
  installed: false,
  authenticated: false,
  installMethod: 'homebrew',
};
const manualMissing: GithubAvailability = {
  installed: false,
  authenticated: false,
  installMethod: 'manual',
};
const signedOut: GithubAvailability = {
  installed: true,
  authenticated: false,
  installMethod: null,
};
const ready: GithubAvailability = {
  installed: true,
  authenticated: true,
  installMethod: null,
};

test('a repository change resets setup under a new request unless a device sign-in is active', () => {
  const populated = {
    ...initialGithubSetupState,
    requestId: 4,
    availability: manualMissing,
    error: 'failed',
    manualGuideOpened: true,
  };

  const reset = githubSetupReducer(populated, { type: 'reset', requestId: 5 });

  assert.deepEqual(reset, { ...initialGithubSetupState, requestId: 5 });
  assert.equal(shouldResetGithubSetupForRepository(initialGithubSetupState), true);
  assert.equal(
    shouldResetGithubSetupForRepository({
      ...initialGithubSetupState,
      action: 'authenticating',
      authCode: 'ABCD-7HJK',
      isAuthPopoverOpen: true,
    }),
    false,
  );
});

test('stale probe and action results cannot update the current repository', () => {
  const current = { ...initialGithubSetupState, requestId: 8 };

  assert.equal(
    githubSetupReducer(current, {
      type: 'probe-finished',
      requestId: 7,
      availability: ready,
    }),
    current,
  );
  assert.equal(
    githubSetupReducer(current, {
      type: 'action-failed',
      requestId: 7,
      message: 'stale failure',
    }),
    current,
  );
});

test('current probe and action events produce explicit setup states', () => {
  const probing = githubSetupReducer(initialGithubSetupState, {
    type: 'probe-started',
    requestId: 1,
  });
  const missing = githubSetupReducer(probing, {
    type: 'probe-finished',
    requestId: 1,
    availability: homebrewMissing,
  });
  const installing = githubSetupReducer(missing, {
    type: 'action-started',
    requestId: 2,
    action: 'installing',
  });
  const failed = githubSetupReducer(installing, {
    type: 'action-failed',
    requestId: 2,
    message: 'Homebrew failed.',
  });

  assert.equal(missing.availability, homebrewMissing);
  assert.equal(installing.action, 'installing');
  assert.equal(installing.error, null);
  assert.equal(failed.action, 'idle');
  assert.equal(failed.error, 'Homebrew failed.');
});

test('device code keeps authentication visible until the operation settles', () => {
  const signedOutState = { ...initialGithubSetupState, requestId: 1, availability: signedOut };
  const authenticating = githubSetupReducer(signedOutState, {
    type: 'action-started',
    requestId: 2,
    action: 'authenticating',
  });
  const withCode = githubSetupReducer(authenticating, {
    type: 'auth-code-received',
    requestId: 2,
    code: 'ABCD-7HJK',
  });

  assert.equal(withCode.action, 'authenticating');
  assert.equal(withCode.authCode, 'ABCD-7HJK');
  assert.equal(withCode.isAuthPopoverOpen, true);

  const closed = githubSetupReducer(withCode, { type: 'auth-popover-closed', requestId: 2 });
  assert.equal(closed.authCode, 'ABCD-7HJK');
  assert.equal(closed.isAuthPopoverOpen, false);

  const reopened = githubSetupReducer(closed, { type: 'auth-popover-opened', requestId: 2 });
  assert.equal(reopened.isAuthPopoverOpen, true);

  const failed = githubSetupReducer(reopened, {
    type: 'action-failed',
    requestId: 2,
    message: 'GitHub sign-in was cancelled.',
  });
  assert.equal(failed.action, 'idle');
  assert.equal(failed.authCode, null);
  assert.equal(failed.isAuthPopoverOpen, false);
});

test('primary action matches the next user-visible operation', () => {
  assert.equal(primaryActionFor(initialGithubSetupState), 'none');
  assert.equal(
    primaryActionFor({ ...initialGithubSetupState, availability: homebrewMissing }),
    'install',
  );
  assert.equal(
    primaryActionFor({ ...initialGithubSetupState, availability: manualMissing }),
    'install',
  );
  assert.equal(
    primaryActionFor({
      ...initialGithubSetupState,
      availability: manualMissing,
      manualGuideOpened: true,
    }),
    'check',
  );
  assert.equal(
    primaryActionFor({ ...initialGithubSetupState, availability: signedOut }),
    'authenticate',
  );
  assert.equal(primaryActionFor({ ...initialGithubSetupState, availability: ready }), 'none');
  assert.equal(
    primaryActionFor({
      ...initialGithubSetupState,
      availability: homebrewMissing,
      action: 'installing',
    }),
    'none',
  );
});

test('manual install guide rechecks only when the app becomes visible', () => {
  const guideOpen = {
    ...initialGithubSetupState,
    availability: manualMissing,
    manualGuideOpened: true,
  };

  assert.equal(shouldRefreshGithubOnVisibility(guideOpen, false), true);
  assert.equal(shouldRefreshGithubOnVisibility(guideOpen, true), false);
  assert.equal(
    shouldRefreshGithubOnVisibility({ ...guideOpen, manualGuideOpened: false }, false),
    false,
  );
});
