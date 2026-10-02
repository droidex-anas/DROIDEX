import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EnvironmentReport } from '../../types/bridge';
import { stepsForEnv, advancePastRemovedStep } from './stepFlow';

function envReport(cliPresent: boolean): EnvironmentReport {
  return {
    platform: 'darwin',
    arch: 'arm64',
    node: { present: true, version: '22.0.0' },
    cli: { present: cliPresent, version: cliPresent ? '1.0.0' : undefined },
    packageManagers: { brew: true },
    auth: { loginPresent: false, apiKeyConfigured: false },
    availableChannels: ['script'],
  } as EnvironmentReport;
}

test('the install step stays until the CLI is known to be present', () => {
  const withInstall = ['welcome', 'system', 'install', 'signin', 'preferences', 'done'];
  assert.deepEqual(stepsForEnv(null), withInstall);
  assert.deepEqual(stepsForEnv(envReport(false)), withInstall);
  assert.deepEqual(stepsForEnv(envReport(true)), [
    'welcome',
    'system',
    'signin',
    'preferences',
    'done',
  ]);
});

test('advancePastRemovedStep moves forward in canonical order, else falls back to the last step', () => {
  const steps = stepsForEnv(envReport(true));
  assert.equal(advancePastRemovedStep(steps, 'install'), 'signin');
  assert.equal(advancePastRemovedStep(steps, 'welcome'), 'welcome');
  // A step at the very end of the canonical order can only fall back.
  assert.equal(advancePastRemovedStep(steps.slice(0, -1), 'done'), 'preferences');
});
