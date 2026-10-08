import test from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from './bridge';
import {
  exportSessionMarkdown,
  setBackgroundWork,
  setHistoryIndexingIdle,
  withdrawSteer,
} from './commands';
import { resetRuntimeHealthForTests, setTransportHealth } from './runtimeHealth';
import type { ClientCommand, ServerEvent } from '../types/bridge';

// Drives request/reply commands through the bridge singleton with an in-memory double.
function fakeBridge(): {
  sent: ClientCommand[];
  emit: (event: ServerEvent) => void;
  restore: () => void;
} {
  const listeners = new Set<(event: ServerEvent) => void>();
  const sent: ClientCommand[] = [];
  const originalSendIfConnected = bridge.sendIfConnected.bind(bridge);
  const originalSubscribe = bridge.subscribe.bind(bridge);
  bridge.sendIfConnected = (command: ClientCommand): boolean => {
    sent.push(command);
    return true;
  };
  bridge.subscribe = (listener: (event: ServerEvent) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    sent,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    restore: () => {
      bridge.sendIfConnected = originalSendIfConnected;
      bridge.subscribe = originalSubscribe;
    },
  };
}

function exportRequestId(sent: ClientCommand[]): string {
  const command = sent.at(-1);
  assert.ok(command?.type === 'session.exportMarkdown');
  return command.requestId;
}

test('history indexing idle samples are ephemeral and use the connected-only lane', () => {
  const fake = fakeBridge();
  try {
    assert.equal(setHistoryIndexingIdle(true), true);
    assert.deepEqual(fake.sent, [{ type: 'history.indexingIdle', isIdle: true }]);
  } finally {
    fake.restore();
  }
});

test('background work tier samples are ephemeral and use the connected-only lane', () => {
  const fake = fakeBridge();
  try {
    assert.equal(setBackgroundWork('hidden', 'app-1', ['app-1', 'app-2']), true);
    assert.deepEqual(fake.sent, [
      {
        type: 'app.backgroundWork',
        tier: 'hidden',
        focusedAppSessionId: 'app-1',
        visibleAppSessionIds: ['app-1', 'app-2'],
      },
    ]);
  } finally {
    fake.restore();
  }
});

test('lost withdrawal requests can be reasked and only the current receipt restores the full prompt', async () => {
  const fake = fakeBridge();
  try {
    setTransportHealth('connected');
    const pending = withdrawSteer('app-1', 'steer-1');
    const first = fake.sent.at(-1);
    assert.ok(first?.type === 'session.withdrawSteer');
    setTransportHealth('disconnected');
    assert.deepEqual(await pending, { withdrawn: false, lost: true });

    const sendIfConnected = bridge.sendIfConnected;
    bridge.sendIfConnected = () => false;
    assert.deepEqual(await withdrawSteer('app-1', 'steer-1'), { withdrawn: false, lost: true });
    bridge.sendIfConnected = sendIfConnected;
    setTransportHealth('connected');
    const retry = withdrawSteer('app-1', 'steer-1');
    const current = fake.sent.at(-1);
    assert.ok(current?.type === 'session.withdrawSteer');
    const receipt = {
      type: 'session.steerWithdrawn' as const,
      appSessionId: 'app-1',
      steerId: 'steer-1',
      withdrawn: true,
    };
    fake.emit({ ...receipt, requestId: first.requestId, text: 'stale' });
    const text = 'Full prompt\n'.repeat(300);
    const mentions = [{ kind: 'skill' as const, name: 'review', path: '/skills/review' }];
    fake.emit({ ...receipt, requestId: current.requestId, text, mentions });
    assert.deepEqual(await retry, { withdrawn: true, text, mentions });
  } finally {
    fake.restore();
    resetRuntimeHealthForTests();
  }
});

test('exportSessionMarkdown resolves the markdown for its own request id only', async () => {
  const fake = fakeBridge();
  try {
    const pending = exportSessionMarkdown('app-1', 'Chat');
    const requestId = exportRequestId(fake.sent);

    fake.emit({ type: 'session.markdownExported', requestId: 'other', ok: true, markdown: '# no' });
    fake.emit({ type: 'session.markdownExported', requestId, ok: true, markdown: '# yes' });

    assert.equal(await pending, '# yes');
  } finally {
    fake.restore();
  }
});

test('exportSessionMarkdown rejects only on its own unsupported-command error, with the code attached', async () => {
  // Version skew: a foreign unsupported command failing concurrently (or one
  // without a request id) must not reject an unrelated in-flight export, and
  // the rejection carries the code so callers can skip a duplicate toast.
  const fake = fakeBridge();
  try {
    const pending = exportSessionMarkdown('app-1', 'Chat');
    const requestId = exportRequestId(fake.sent);

    let settled = false;
    const watched = pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    fake.emit({
      type: 'error',
      code: 'bridge.unsupported_command',
      requestId: 'someone-else',
      message: 'foreign',
    });
    fake.emit({ type: 'error', code: 'bridge.unsupported_command', message: 'no id' });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(settled, false);

    fake.emit({
      type: 'error',
      code: 'bridge.unsupported_command',
      requestId,
      message: 'restart now',
    });
    await watched;
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'restart now');
      assert.equal((error as { code?: unknown }).code, 'bridge.unsupported_command');
      return true;
    });
  } finally {
    fake.restore();
  }
});
