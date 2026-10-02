import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider } from '../../../hooks/useStore';
import type { GithubSetupController } from '../../../hooks/useGithubSetup';
import { PrGithubSetupEmpty, PrWorkspaceEmpty } from './PrWorkspaceEmpty';

const signedOut = {
  installed: true,
  authenticated: false,
  installMethod: null,
} as const;

function setupController(overrides: Partial<GithubSetupController> = {}): GithubSetupController {
  return {
    availability: signedOut,
    action: 'idle',
    error: null,
    manualGuideOpened: false,
    authCode: null,
    isAuthPopoverOpen: false,
    isReady: false,
    refresh: () => undefined,
    runPrimaryAction: () => undefined,
    showAuthPrompt: () => undefined,
    closeAuthPrompt: () => undefined,
    cancelAuthentication: () => undefined,
    ...overrides,
  };
}

function renderSetup(overrides: Partial<GithubSetupController> = {}): string {
  return renderToStaticMarkup(
    createElement(PrGithubSetupEmpty, { setup: setupController(overrides) }),
  );
}

test('authenticating with a device code shows the existing prompt, not a dead button', () => {
  const html = renderSetup({
    action: 'authenticating',
    authCode: 'ABCD-7HJK',
    isAuthPopoverOpen: true,
  });

  assert.match(html, /ABCD-7HJK/);
  assert.match(html, /Enter this code on GitHub/);
  assert.match(html, /Copy code/);
  assert.match(html, /Cancel sign-in/);
  assert.doesNotMatch(html, /Show sign-in code/);
  assert.doesNotMatch(html, /Waiting for GitHub/);
});

test('each setup state offers only the action that works in it', () => {
  const cases: [string, Partial<GithubSetupController>, RegExp[], RegExp[]][] = [
    ['signed out', {}, [/Sign in to GitHub/], [/Enter this code on GitHub/, /Cancel sign-in/]],
    [
      'authenticating without a device code',
      { action: 'authenticating' },
      [/Waiting for GitHub…/, /Cancel sign-in/],
      [/ABCD-7HJK/],
    ],
    [
      'installing manually',
      {
        availability: { installed: false, authenticated: false, installMethod: 'manual' },
        action: 'installing',
      },
      [/Installing…/],
      [/Cancel installation/],
    ],
  ];
  for (const [name, overrides, present, absent] of cases) {
    const html = renderSetup(overrides);
    for (const pattern of present) assert.match(html, pattern, name);
    for (const pattern of absent) assert.doesNotMatch(html, pattern, name);
  }
});

test('setup errors are announced when they change', () => {
  const html = renderSetup({ error: 'GitHub CLI setup failed' });

  assert.match(html, /aria-live="polite"/);
  assert.match(html, /GitHub CLI setup failed/);
});

test('a non-GitHub binding offers a replacement workspace action', () => {
  const html = renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state: initialState, dispatch: () => undefined },
      createElement(PrWorkspaceEmpty, {
        cwd: '/removed-repository',
        gitLoaded: true,
        isGitHub: false,
        setup: setupController(),
      }),
    ),
  );

  assert.match(html, /This folder is not a GitHub repository\./);
  assert.match(html, /Choose another workspace/);
});
