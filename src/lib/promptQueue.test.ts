import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalDesignTranscriptEvent,
  createPromptQueueDeliveryGuard,
  promptChips,
} from './promptQueue';

test('queued prompt delivery coalesces overlap into one trailing retry', async () => {
  const guard = createPromptQueueDeliveryGuard();
  let release = (): void => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let deliveries = 0;

  const first = guard.run(async () => {
    deliveries += 1;
    await pending;
    throw new Error('transient delivery failure');
  });
  const trailing = guard.run(async () => {
    deliveries += 1;
  });
  assert.equal(deliveries, 1);

  release();
  await Promise.all([first, trailing]);
  assert.equal(deliveries, 2);

  await guard.run(async () => {
    deliveries += 1;
  });
  assert.equal(deliveries, 3);
});
test('a design prompt’s bubble shows the frames and components it carried', () => {
  const kit = { id: 'acme', version: 3, mode: 'light' as const };
  const queued = {
    sideChatReplies: ['Keep it short.'],
    framePins: [
      {
        canvasId: 'cv_1',
        designId: 'd1',
        revisionId: 'r1',
        name: 'Hero',
        size: '480 × 320',
        designSystem: kit,
      },
    ],
    componentPins: [{ kit, kitName: 'Acme', name: 'Button' }],
  };
  const event = createLocalDesignTranscriptEvent('chat', 'Use these', [], {
    skills: [],
    files: [],
    ...promptChips(queued),
  });
  assert.deepEqual(event.sideChatReplies, ['Keep it short.']);
  assert.deepEqual(event.canvasFrames, ['Hero']);
  assert.deepEqual(event.canvasComponents, ['Button']);
  assert.deepEqual(promptChips({}), {});
});
