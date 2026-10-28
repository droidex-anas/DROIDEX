import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RemoteMessage } from '../../../packages/remote/src/application.js';
import { PeerSession } from './peerSession.js';

test(
  'bridge opens reserve their IDs and capacity until failure, cancellation or session close',
  { timeout: 10_000 },
  async (t) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    t.after(() => {
      for (const socket of server.clients) socket.terminate();
      server.close();
    });
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    type BridgeInfo = { port: number; token: string };
    const pending: { resolve(value: BridgeInfo): void; reject(error: Error): void }[] = [];
    const messages: RemoteMessage[] = [];
    const events = new EventEmitter();
    const session = new PeerSession({
      peerId: 'browser',
      desktop: {
        open() {},
        close() {},
        call() {},
        listen: () => () => {},
        openTerminal: () => ({ post() {}, close() {} }),
      },
      bridgeInfo: () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
      send: (message) => {
        messages.push(message);
        events.emit('message', message);
      },
      queuedChars: () => 0,
    });
    t.after(() => session.close());
    const open = (socketId: number) =>
      session.handle({ type: 'bridge.open', socketId, params: '' });
    open(0);
    open(0);
    for (let id = 1; id <= 4; id++) open(id);
    assert.equal(pending.length, 4);
    assert.deepEqual(
      messages.map((message) => (message.type === 'bridge.closed' ? message.socketId : null)),
      [0, 4],
    );

    const failed = once(events, 'message');
    pending[0].reject(new Error('Runtime offline'));
    await failed;
    open(0);
    session.handle({ type: 'bridge.close', socketId: 1 });
    open(1);
    assert.equal(pending.length, 6);
    const connections: WebSocket[] = [];
    const connected = new Promise<void>((resolve) => {
      server.on('connection', (socket) => {
        connections.push(socket);
        if (connections.length === 4) resolve();
      });
    });
    const info = { port: address.port, token: 'test' };
    for (const request of pending.slice(1)) request.resolve(info);
    await connected;
    const closed = Promise.all(connections.map((socket) => once(socket, 'close')));
    session.close();
    await closed;
    assert.equal(server.clients.size, 0);

    // A provisional open owned by a closed session must never create a socket.
    const closing = new PeerSession({
      peerId: 'closing',
      desktop: {
        open() {},
        close() {},
        call() {},
        listen: () => () => {},
        openTerminal: () => ({ post() {}, close() {} }),
      },
      bridgeInfo: () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
      send() {},
      queuedChars: () => 0,
    });
    closing.handle({ type: 'bridge.open', socketId: 0, params: '' });
    closing.close();
    pending[6].resolve(info);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(connections.length, 4);
  },
);
