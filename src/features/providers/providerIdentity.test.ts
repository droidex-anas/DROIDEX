import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderStatus } from '../../types/bridge';
import {
  PROVIDER_LABELS,
  PROVIDER_MARKS,
  PROVIDER_SIGN_IN_COMMANDS,
  harnessChoice,
  sessionResumeCommand,
  sessionResumeId,
  supportsSpecMode,
} from './providerIdentity';

test('Devin identity uses its CLI login, native session handle and planning mode', () => {
  assert.equal(PROVIDER_LABELS.devin, 'Devin');
  assert.equal(PROVIDER_MARKS.devin, 'devin');
  assert.equal(PROVIDER_SIGN_IN_COMMANDS.devin, 'devin auth login');
  assert.equal(sessionResumeId({ provider: 'devin', providerSessionId: 'acp-id' }), 'acp-id');
  assert.equal(sessionResumeCommand('devin', "'acp-id'"), "devin --resume 'acp-id'");
  assert.equal(supportsSpecMode('devin'), true);
});

test('Devin is selectable only when its provider probe is ready', () => {
  const ready: ProviderStatus = { provider: 'devin', readiness: 'ready', models: [] };
  assert.deepEqual(harnessChoice('devin', 'droid', [ready]), {
    selected: false,
    disabled: false,
    title: 'Run this chat on Devin',
  });
  assert.equal(harnessChoice('devin', 'droid', []).disabled, true);
  const signedOut: ProviderStatus = {
    ...ready,
    readiness: 'unauthenticated',
    message: 'Run devin auth login to sign in.',
  };
  assert.equal(harnessChoice('devin', 'droid', [signedOut]).title, signedOut.message);
  assert.equal(harnessChoice('devin', 'droid', [signedOut]).disabled, true);
});
