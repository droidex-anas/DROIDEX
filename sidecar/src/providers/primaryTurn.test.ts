import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiveSession } from '../SessionLifecycle.js';
import { runPrimaryTurn, type PrimaryTurnDependencies } from './primaryTurn.js';

// A turn whose prompt is still being stored until `storePrompt` is called.
function turnUnderTest() {
  let storePrompt: () => void = () => undefined;
  const streamed: string[] = [];
  const liveSession = {
    summary: { appSessionId: 'app' },
    interrupting: false,
    session: {
      // eslint-disable-next-line require-yield -- the turn under test must never reach a stream
      stream: async function* (prompt: string) {
        streamed.push(prompt);
      },
    },
  } as unknown as LiveSession;
  const storing = () =>
    new Promise<void>((resolve) => {
      storePrompt = resolve;
    });
  const dependencies: PrimaryTurnDependencies = {
    eventFlow: { beginTurn: () => undefined, apply: () => undefined },
    context: {
      beginTurn: () => undefined,
      startPolling: () => undefined,
      stopPolling: () => undefined,
      refresh: () => Promise.resolve(),
    },
    timeline: {
      recordPrompt: storing,
      announcePrompt: storing,
      settleStreaming: () => Promise.resolve(),
      appendStatus: () => undefined,
      appendError: () => undefined,
    },
    contextTarget: () => undefined,
    isCurrent: () => true,
    applyDesignToolPolicy: () => Promise.resolve(true),
    updateSummary: () => undefined,
    emitError: () => undefined,
  } as unknown as PrimaryTurnDependencies;
  return { liveSession, dependencies, streamed, storePrompt: () => storePrompt() };
}

test('a Stop that lands while the prompt is being stored keeps the turn from starting', async () => {
  const { liveSession, dependencies, streamed, storePrompt } = turnUnderTest();

  const turn = runPrimaryTurn(dependencies, liveSession, { prompt: 'do the work' });
  liveSession.interrupting = true;
  storePrompt();
  await turn;

  assert.deepEqual(streamed, []);
});

test('a scheduled delivery withdrawn while its prompt is stored is declined', async () => {
  const { liveSession, dependencies, streamed, storePrompt } = turnUnderTest();
  let current = true;
  const outcomes: string[] = [];
  const delivery = {
    isCurrent: () => current,
    accepted: () => outcomes.push('accepted'),
    declined: () => outcomes.push('declined'),
  };

  const turn = runPrimaryTurn(dependencies, liveSession, {
    prompt: 'from the project',
    delivery,
    announce: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  storePrompt();
  await turn;

  assert.deepEqual(streamed, []);
  assert.deepEqual(outcomes, ['declined']);
});
