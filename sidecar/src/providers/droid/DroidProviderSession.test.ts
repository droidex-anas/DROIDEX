import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DroidClient,
  DroidSession,
  InitializeSessionResultSchema,
  ReasoningEffort,
  type DroidClientTransport,
} from '@factory/droid-sdk';
import { wrapDroidTransport } from '../../DroidTransport.js';
import { DroidProviderSession } from './DroidProviderSession.js';

async function createHarness() {
  let receive: (message: Record<string, unknown>) => void = () => undefined;
  let acceptPrompt: () => void = () => undefined;
  const promptAccepted = new Promise<void>((resolve) => {
    acceptPrompt = resolve;
  });
  const init = InitializeSessionResultSchema.parse({
    sessionId: 'provider-session',
    session: {},
    settings: { modelId: 'test-model', reasoningEffort: ReasoningEffort.Medium },
  });
  const inner: DroidClientTransport = {
    isConnected: true,
    send(request) {
      receive({
        jsonrpc: '2.0',
        factoryApiVersion: '1.0.0',
        type: 'response',
        id: request.id,
        result: request.method === 'droid.initialize_session' ? init : {},
      });
      if (request.method === 'droid.add_user_message') acceptPrompt();
    },
    onMessage(callback) {
      receive = callback;
    },
    onError() {},
    close: async () => undefined,
  };
  const transport = wrapDroidTransport(inner);
  const client = new DroidClient({ transport });
  await client.initializeSession({ machineId: 'test', cwd: '/tmp' });
  const droid = new DroidSession(client, init.sessionId, init);
  const session = new DroidProviderSession('app-session', droid, {
    processIdOf: () => undefined,
    isProcessAlive: () => true,
  });
  return {
    session,
    promptAccepted,
    notify(notification: Record<string, unknown>) {
      receive({
        jsonrpc: '2.0',
        factoryApiVersion: '1.0.0',
        type: 'notification',
        method: 'droid.session_notification',
        params: { notification },
      });
    },
  };
}

// The SDK does not know "thinking", so it yields no result for this turn.
test('a turn that thinks, fails and goes idle ends, whichever of the error and the idle notice is seen first', async () => {
  for (const idleBeforeConsumption of [true, false]) {
    const h = await createHarness();
    try {
      const stream = h.session.stream('hello');
      const first = stream.next();
      await h.promptAccepted;
      h.notify({ type: 'droid_working_state_changed', newState: 'thinking' });
      h.notify({
        type: 'error',
        message: 'Model connection failed',
        errorType: 'ConnectionError',
        timestamp: '2026-10-02T00:00:00Z',
      });
      if (idleBeforeConsumption)
        h.notify({ type: 'droid_working_state_changed', newState: 'idle' });
      const event = await first;
      assert.equal(event.value?.transcript?.kind, 'error');
      assert.equal(event.value?.transcript?.text, 'Model connection failed');
      const settlement = stream.next();
      if (!idleBeforeConsumption)
        h.notify({ type: 'droid_working_state_changed', newState: 'idle' });
      assert.equal((await settlement).done, true);
    } finally {
      await h.session.close();
    }
  }
});
