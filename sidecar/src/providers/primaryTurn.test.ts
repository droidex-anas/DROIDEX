import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiveSession } from '../SessionLifecycle.js';
import { runPrimaryTurn, type PrimaryTurnDependencies } from './primaryTurn.js';

test('a Stop that lands while the prompt is being stored keeps the turn from starting', async () => {
  let promptStored: () => void = () => undefined;
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
  const dependencies: PrimaryTurnDependencies = {
    eventFlow: { beginTurn: () => undefined, apply: () => undefined },
    context: {
      beginTurn: () => undefined,
      startPolling: () => undefined,
      stopPolling: () => undefined,
      refresh: () => Promise.resolve(),
    },
    timeline: {
      recordPrompt: () =>
        new Promise<void>((resolve) => {
          promptStored = resolve;
        }),
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

  const turn = runPrimaryTurn(dependencies, liveSession, { prompt: 'do the work' });
  liveSession.interrupting = true;
  promptStored();
  await turn;

  assert.deepEqual(streamed, []);
});
