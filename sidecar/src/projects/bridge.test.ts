import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { createProjectCommandHandler } from './bridge.js';

test('failed project commands emit bounded errors and only valid request identities', async () => {
  for (const message of ['', 'x'.repeat(8_193)]) {
    const events: ServerEvent[] = [];
    const handle = createProjectCommandHandler(Promise.reject(new Error(message)), (event) =>
      events.push(event),
    );
    assert.equal(
      await handle({
        type: 'project.pause',
        requestId: 'request',
        projectId: 'project',
        paused: true,
      }),
      true,
    );
    assert.deepEqual(events, [
      {
        type: 'project.result',
        requestId: 'request',
        ok: false,
        error: message ? 'x'.repeat(8_192) : 'Projects command failed.',
      },
    ]);
  }

  const events: ServerEvent[] = [];
  const handle = createProjectCommandHandler(new Promise(() => {}), (event) => events.push(event));
  for (const requestId of [undefined, '', 'x'.repeat(201)]) {
    assert.equal(await handle({ type: 'project.pause', requestId }), true);
    assert.deepEqual(events.pop(), {
      type: 'error',
      code: 'project.invalid_command',
      message: 'Invalid Projects command.',
    });
  }
  const requestId = 'x'.repeat(200);
  assert.equal(await handle({ type: 'project.pause', requestId }), true);
  assert.deepEqual(events.pop(), {
    type: 'project.result',
    requestId,
    ok: false,
    error: 'Invalid Projects command.',
  });
});
