import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSetupBlocker,
  onboardingStateRevision,
  publishOnboardingState,
  resolveOnboardingRead,
  scheduleEnvDetect,
  shouldShowOnboarding,
  subscribeOnboardingState,
} from './useOnboarding';
import type { EnvironmentReport } from '../types/bridge';

function env(partial: Partial<EnvironmentReport>): EnvironmentReport {
  return {
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '24.0.0',
    node: { present: true, version: '22.0.0' },
    cli: { present: true, path: '/usr/bin/droid', version: '0.144.2' },
    packageManagers: { brew: true, npm: true, curl: true, pnpm: false },
    auth: { apiKeyConfigured: false, loginPresent: true },
    availableChannels: ['script', 'brew', 'npm'],
    ...partial,
  };
}

test('onboarding shows until completed, and a missing CLI or sign-in without a key blocks setup', () => {
  assert.equal(shouldShowOnboarding(null), false);
  assert.equal(shouldShowOnboarding({ completed: false }), true);
  assert.equal(shouldShowOnboarding({ completed: true }), false);

  assert.equal(hasSetupBlocker(env({ cli: { present: false, path: 'droid' } })), true);
  const auth = (apiKeyConfigured: boolean, loginPresent: boolean) =>
    hasSetupBlocker(env({ auth: { apiKeyConfigured, loginPresent } }));
  assert.equal(auth(false, false), true);
  assert.equal(auth(false, true), false);
  assert.equal(auth(true, false), false);
  assert.equal(hasSetupBlocker(null), false);
});

test('scheduleEnvDetect probes now, or on idle unless cancelled first', () => {
  let calls = 0;
  const probe = () => {
    calls += 1;
  };
  scheduleEnvDetect(false, probe, () => {
    throw new Error('idle scheduler must not be used when not deferring');
  })();
  assert.equal(calls, 1);

  let pending: (() => void) | undefined;
  scheduleEnvDetect(true, probe, (callback) => {
    pending = callback;
    return () => {};
  });
  assert.equal(calls, 1, 'no probe before idle');
  pending?.();
  assert.equal(calls, 2);

  let cancelled = false;
  scheduleEnvDetect(true, probe, () => () => {
    cancelled = true;
  })();
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
});

test('onboarding preference changes notify every mounted controller', () => {
  const seen: boolean[] = [];
  const unsubscribe = subscribeOnboardingState((state) => {
    seen.push(state.appAutoUpdate ?? true);
  });

  const seenBeforePublish = seen.length;
  const before = onboardingStateRevision();
  publishOnboardingState({ completed: true, version: 1, appAutoUpdate: false });
  assert.equal(onboardingStateRevision(), before + 1);
  assert.equal(seen.length, seenBeforePublish + 1);
  assert.equal(seen.at(-1), false);
  unsubscribe();
  publishOnboardingState({ completed: true, version: 1, appAutoUpdate: true });

  assert.equal(seen.length, seenBeforePublish + 1);
});

test('a stale onboarding read cannot overwrite a newer preference publication', () => {
  const readStartedAt = onboardingStateRevision();
  publishOnboardingState({ completed: true, version: 1, appAutoUpdate: false });

  assert.deepEqual(
    resolveOnboardingRead(readStartedAt, {
      completed: true,
      version: 1,
      appAutoUpdate: true,
    }),
    { completed: true, version: 1, appAutoUpdate: false },
  );
});
