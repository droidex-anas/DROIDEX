import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionRuntimeWarmUp } from './sessionRuntimeWarmUp.js';

test('a warm-up queued behind another is skipped once its chat is no longer selected', async () => {
  // Chat A is still resuming when the user settles on B, so B waits behind A.
  // Moving on to C before A finishes must drop B: only what is on screen when
  // its turn comes is worth a process.
  const resumed: string[] = [];
  let finishA = (): void => undefined;
  const warmUp = new SessionRuntimeWarmUp({
    ready: () => Promise.resolve(),
    isResumable: () => true,
    isLive: () => false,
    resume: (id) => {
      resumed.push(id);
      return id === 'A' ? new Promise<void>((resolve) => (finishA = resolve)) : Promise.resolve();
    },
  });

  warmUp.selected('A');
  const a = warmUp.flush();
  // Let A's resume actually begin before the selection moves on.
  await new Promise((resolve) => setImmediate(resolve));
  warmUp.selected('B');
  const b = warmUp.flush();
  warmUp.selected('C');
  finishA();
  await Promise.all([a, b]);
  assert.deepEqual(resumed, ['A'], 'B was left before its turn came, so it never resumes');

  await warmUp.flush();
  assert.deepEqual(resumed, ['A', 'C'], 'the chat that is on screen still warms');
});

test('warm-up owns readiness and resume failures once and permits a later attempt', async (t) => {
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  let attempts = 0;
  let readyFails = true;
  const warmUp = new SessionRuntimeWarmUp({
    ready: async () => {
      if (readyFails) throw new Error('readiness failed');
    },
    isResumable: () => true,
    isLive: () => false,
    resume: async () => {
      if (++attempts === 1) throw new Error('resume failed');
    },
  });
  t.after(() => warmUp.stop());
  warmUp.selected('A');
  await warmUp.flush();
  readyFails = false;
  warmUp.selected('A');
  await warmUp.flush();
  warmUp.selected('A');
  await warmUp.flush();
  assert.equal(attempts, 2);
  assert.deepEqual(errors, [
    ['Could not warm session runtime: readiness failed'],
    ['Could not warm session runtime: resume failed'],
  ]);
});

test('selection abandoned while readiness is pending never begins resuming', async (t) => {
  const resumed: string[] = [];
  let reconcile = (): void => undefined;
  const ready = new Promise<void>((resolve) => {
    reconcile = resolve;
  });
  let waiting = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const warmUp = new SessionRuntimeWarmUp({
    ready: () => {
      waiting();
      return ready;
    },
    isResumable: () => true,
    isLive: () => false,
    resume: async (id) => {
      resumed.push(id);
    },
  });
  t.after(() => warmUp.stop());
  warmUp.selected('A');
  const first = warmUp.flush();
  await started;
  warmUp.selected('B');
  const second = warmUp.flush();
  reconcile();
  await Promise.all([first, second]);
  assert.deepEqual(resumed, ['B']);
});
