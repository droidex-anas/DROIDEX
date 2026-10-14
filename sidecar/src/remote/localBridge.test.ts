import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { WebSocketServer } from 'ws';
import { test } from 'node:test';
import type { RemoteMessage } from '../../../packages/remote/src/application';
import { RemoteLocalBridge } from './localBridge';
import type { LocalEvent, LocalSession } from './localEvents';

test(
  'local bridge preserves literal deltas and its active tail when history refreshes',
  { timeout: 5000 },
  async (t) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const messages: RemoteMessage[] = [];
    const published = new EventEmitter();
    const bridge = new RemoteLocalBridge({
      bridgeInfo: () => Promise.resolve({ port: address.port, token: 'test-local-bridge' }),
      workspace: () => '/workspace',
      publish: (message) => {
        messages.push(message);
        if (message.type === 'snapshot') published.emit('snapshot');
      },
    });
    t.after(async () => {
      bridge.stop();
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) => {
        server.close((error: Error | undefined) => (error ? reject(error) : resolve()));
      });
    });
    const connected = once(server, 'connection');
    bridge.start();
    const [producer] = await connected;
    const [request] = await once(producer, 'message');
    assert.deepEqual(JSON.parse(String(request)), { type: 'remote.snapshot' });
    const session: LocalSession = {
      appSessionId: 'task',
      title: 'A live task',
      provider: 'claude',
      autonomy: 'off',
      phase: 'running',
      streaming: true,
    };
    const deliver = async (...events: LocalEvent[]) => {
      const received = once(published, 'snapshot');
      producer.send(
        JSON.stringify({
          type: 'events.batch',
          events: [...events, { type: 'remote.snapshot', sessions: [session], approvals: [] }].map(
            (event) => ({ event }),
          ),
        }),
      );
      await received;
    };
    const text = (id: string, value: string, author?: 'user'): LocalEvent => ({
      type: 'event.appended',
      event: { appSessionId: 'task', id, kind: 'text', text: value, role: 'primary', author },
    });

    await deliver(
      { type: 'session.created', session },
      text('delta-1', 'hel'),
      text('delta-2', 'lo'),
    );
    assert.deepEqual(
      messages.flatMap((message) => (message.type === 'stream' ? [message.text] : [])),
      ['hel', 'lo'],
    );
    bridge.execute({ type: 'open', sessionId: 'task' });
    assert.deepEqual(messages.at(-1), { type: 'history', sessionId: 'task', text: 'hello' });

    await deliver(
      { type: 'session.history', appSessionId: 'task', transcripts: [] },
      {
        type: 'session.history',
        appSessionId: 'task',
        transcripts: [
          { appSessionId: 'task', id: 'stored-old', kind: 'text', text: 'Older persisted answer' },
        ],
      },
    );
    bridge.execute({ type: 'open', sessionId: 'task' });
    assert.deepEqual(messages.at(-1), { type: 'history', sessionId: 'task', text: 'hello' });

    await deliver(text('user-1', 'Continue', 'user'), text('delta-3', 'Ready'));
    bridge.execute({ type: 'open', sessionId: 'task' });
    assert.deepEqual(messages.at(-1), {
      type: 'history',
      sessionId: 'task',
      text: 'hello\n\nContinue\n\nReady',
    });
  },
);
