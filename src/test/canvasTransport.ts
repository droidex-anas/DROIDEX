// A Canvas transport the test drives directly, standing in for the bridge
// socket. Shared by the client suite and the design-chat suite, which both have
// to answer real `canvas.*` commands rather than stub the client.

import assert from 'node:assert/strict';
import type { ClientCommand, ServerEvent } from '../types/bridge';
import type { CanvasTransport } from '../features/canvas/client';
import type { CanvasCommand } from '../features/canvas/protocol';

function isCanvasCommand(command: ClientCommand): command is CanvasCommand {
  return command.type.startsWith('canvas.');
}

/**
 * Its `reconnect` is the Bridge's own notification, which only a readmitted
 * socket fires: a first connection sends nothing, and an ordinary replay resume
 * publishes no event, so a client that waited for one would never catch up.
 */
export function fakeCanvasBridge() {
  const sent: CanvasCommand[] = [];
  let receive: ((event: ServerEvent) => void) | null = null;
  let readmitted: (() => void) | null = null;
  let connected = true;
  const transport: CanvasTransport = {
    sendIfConnected(command: ClientCommand) {
      assert.ok(isCanvasCommand(command), 'the Canvas client sent a command it does not own');
      if (!connected) return false;
      sent.push(command);
      return true;
    },
    subscribe(listener) {
      receive = listener;
      return () => {
        receive = null;
      };
    },
    onReconnected(listener) {
      readmitted = listener;
      return () => {
        readmitted = null;
      };
    },
  };
  return {
    sent,
    transport,
    reconnect(): void {
      assert.ok(readmitted, 'the client is not watching for reconnections');
      readmitted();
    },
    /** The transport refusing a command, as it does when nothing is connected. */
    offline(): void {
      connected = false;
    },
    deliver(event: ServerEvent): void {
      assert.ok(receive, 'the client has not subscribed yet');
      receive(event);
    },
    /** The last command of a kind, so a test can answer it. */
    last(type: CanvasCommand['type']): CanvasCommand {
      const matched = sent.filter((command) => command.type === type);
      const command = matched.at(-1);
      assert.ok(command, `no ${type} was sent`);
      return command;
    },
    count(type: CanvasCommand['type']): number {
      return sent.filter((command) => command.type === type).length;
    },
  };
}

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
