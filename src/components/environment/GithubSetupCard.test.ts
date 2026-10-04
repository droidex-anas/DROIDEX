import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { GithubAvailability } from '../../types/vcs.js';
import {
  GithubAuthPromptContent,
  GithubSetupCard,
  type GithubSetupCardProps,
} from './GithubSetupCard.js';

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

function render(
  availability: GithubAvailability | null,
  overrides: Partial<GithubSetupCardProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(GithubSetupCard, {
      availability,
      action: 'idle',
      error: null,
      manualGuideOpened: false,
      authCode: null,
      isAuthPopoverOpen: false,
      onPrimaryAction: () => undefined,
      onShowAuthPrompt: () => undefined,
      onCloseAuthPrompt: () => undefined,
      onCancelAuthentication: () => undefined,
      ...overrides,
    }),
  );
}

test('checking and ready states do not render a recovery card', () => {
  assert.equal(render(null), '');
  assert.equal(render(ready), '');
});

test('each missing setup step offers its own next action', () => {
  const homebrew = render(homebrewMissing);
  assert.match(homebrew, /GitHub CLI required/);
  assert.match(homebrew, /Install GitHub CLI/);

  // Manual installation turns the same action into a verification button.
  assert.match(render(manualMissing), /official installation page/i);
  assert.match(render(manualMissing, { manualGuideOpened: true }), /Check installation/);

  const html = render(signedOut);
  assert.match(html, /Connect GitHub/);
  assert.match(html, /Sign in to GitHub/);
});

test('busy setup states keep an explicit cancellation action available', () => {
  const installing = render(homebrewMissing, { action: 'installing' });
  const authenticating = render(signedOut, { action: 'authenticating' });

  assert.match(installing, /Installing…/);
  assert.match(installing, /disabled=""/);
  assert.match(installing, /Cancel installation/);
  assert.match(authenticating, /Waiting for GitHub…/);
  assert.match(authenticating, /disabled=""/);
  assert.match(authenticating, /Cancel sign-in/);
});

test('authentication with a device code keeps a button to reopen the popover', () => {
  const html = render(signedOut, {
    action: 'authenticating',
    authCode: 'ABCD-7HJK',
    isAuthPopoverOpen: true,
  });

  assert.match(html, /Show sign-in code/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('the device-code popover offers copy and cancel, and explains a clipboard failure', () => {
  const popover = (copyFailed: boolean) =>
    renderToStaticMarkup(
      createElement(GithubAuthPromptContent, {
        code: 'ABCD-7HJK',
        copyFailed,
        onCopy: () => undefined,
        onCancel: () => undefined,
      }),
    );

  const html = popover(false);
  assert.match(html, /ABCD-7HJK/);
  assert.match(html, /Copy code/);
  assert.match(html, /Cancel sign-in/);
  assert.doesNotMatch(html, /Could not copy the code/i);
  assert.match(popover(true), /select it and copy it manually/i);
});

test('setup failures use accessible live text in addition to color', () => {
  const html = render(homebrewMissing, { error: 'Homebrew could not install GitHub CLI.' });

  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Homebrew could not install GitHub CLI/);
});
