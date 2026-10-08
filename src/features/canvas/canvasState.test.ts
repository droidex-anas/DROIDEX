import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREATE_RECOVERY_MESSAGE,
  initialCanvasPaneState,
  openSourceFrame,
  openSourcePanel,
  reduceCanvasPane,
  watchedCanvasId,
  type CanvasPaneState,
} from './canvasState';
import type { CanvasFrame, CanvasSnapshot } from './protocol';

function frame(designId: string, name: string): CanvasFrame {
  return {
    designId,
    name,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    revisionId: null,
    designSystem: { id: 'droidex', version: 1, mode: 'light' },
    build: { status: 'pending', generation: 1 },
  };
}

function snapshot(sequence: number, names: string[], canvasId = 'canvas-1'): CanvasSnapshot {
  return {
    canvasId,
    sequence,
    frames: names.map((name, index) => frame(`design-${String(index)}`, name)),
  };
}

function apply(state: CanvasPaneState, ...events: Parameters<typeof reduceCanvasPane>[1][]) {
  return events.reduce(reduceCanvasPane, state);
}

test('opening the pane only reads: nothing but an explicit Create attaches a canvas', () => {
  const opening = initialCanvasPaneState(null);
  assert.deepEqual(opening, { status: 'opening' });
  assert.equal(watchedCanvasId(opening), null);

  const unattached = reduceCanvasPane(opening, { type: 'attached', canvasId: null });
  assert.deepEqual(unattached, { status: 'unattached', error: '' });
  assert.equal(watchedCanvasId(unattached), null);

  const creating = reduceCanvasPane(unattached, { type: 'creating' });
  assert.equal(creating.status, 'creating');
  assert.equal(watchedCanvasId(creating), null);
  assert.equal(
    watchedCanvasId(reduceCanvasPane(creating, { type: 'created', canvasId: 'canvas-1' })),
    'canvas-1',
  );
});

test('reopening a pane with an unsettled Create keeps recovery ahead of cached attachment', () => {
  assert.deepEqual(initialCanvasPaneState('canvas-old', true), {
    status: 'create-recovering',
    message: CREATE_RECOVERY_MESSAGE,
  });
});

test('a cached attachment loads its canvas and the sidecar answer still decides', () => {
  const cached = initialCanvasPaneState('canvas-1');
  assert.deepEqual(cached, { status: 'loading', canvasId: 'canvas-1' });

  // A canvas the chat no longer has: the cache is dropped, not trusted.
  const gone = reduceCanvasPane(cached, { type: 'attached', canvasId: null });
  assert.deepEqual(gone, { status: 'unattached', error: '' });

  const moved = reduceCanvasPane(cached, { type: 'attached', canvasId: 'canvas-2' });
  assert.deepEqual(moved, { status: 'loading', canvasId: 'canvas-2' });
});

test('selecting a named canvas replaces the displayed board without changing an attachment', () => {
  const attached = apply(initialCanvasPaneState('canvas-B'), {
    type: 'snapshot',
    snapshot: snapshot(3, ['Attached'], 'canvas-B'),
  });
  const named = reduceCanvasPane(attached, { type: 'selected', canvasId: 'canvas-A' });
  assert.deepEqual(named, { status: 'loading', canvasId: 'canvas-A' });
  assert.equal(watchedCanvasId(named), 'canvas-A');
});

test('a confirming attachment answer keeps the snapshot the pane already loaded', () => {
  const ready = apply(initialCanvasPaneState('canvas-1'), {
    type: 'snapshot',
    snapshot: snapshot(4, ['Pricing']),
  });
  assert.equal(ready.status, 'ready');

  assert.equal(reduceCanvasPane(ready, { type: 'attached', canvasId: 'canvas-1' }), ready);
});

test('snapshots move the projection forward only', () => {
  const loading = initialCanvasPaneState('canvas-1');
  const ready = reduceCanvasPane(loading, { type: 'snapshot', snapshot: snapshot(4, ['Pricing']) });
  assert.deepEqual(ready, {
    status: 'ready',
    canvasId: 'canvas-1',
    snapshot: snapshot(4, ['Pricing']),
    sourceDesignId: null,
  });

  // A resync answers with a snapshot taken before the changes already applied.
  assert.equal(reduceCanvasPane(ready, { type: 'snapshot', snapshot: snapshot(3, []) }), ready);
  // The same sequence again changes nothing, so subscribers are not woken.
  assert.equal(
    reduceCanvasPane(ready, { type: 'snapshot', snapshot: snapshot(4, ['Pricing']) }),
    ready,
  );
  // Another canvas's board belongs to another pane.
  assert.equal(
    reduceCanvasPane(ready, { type: 'snapshot', snapshot: snapshot(9, [], 'canvas-2') }),
    ready,
  );

  const advanced = reduceCanvasPane(ready, {
    type: 'snapshot',
    snapshot: snapshot(5, ['Pricing', 'Checkout']),
  });
  assert.equal(advanced.status === 'ready' && advanced.snapshot.sequence, 5);
});

test('a late snapshot cannot resurrect a board the chat has detached from', () => {
  const detached = apply(
    initialCanvasPaneState('canvas-1'),
    { type: 'snapshot', snapshot: snapshot(4, ['Pricing']) },
    { type: 'attached', canvasId: null },
  );
  assert.deepEqual(detached, { status: 'unattached', error: '' });
  assert.equal(
    reduceCanvasPane(detached, { type: 'snapshot', snapshot: snapshot(5, ['Pricing']) }),
    detached,
  );
});

test('a failed Create stays in recovery until the same request is retried', () => {
  const failed = apply(
    initialCanvasPaneState(null),
    { type: 'attached', canvasId: null },
    { type: 'creating' },
    { type: 'create-failed', message: 'DROIDEX is not connected.' },
  );
  assert.deepEqual(failed, { status: 'create-recovering', message: 'DROIDEX is not connected.' });

  // A read can race an unsettled Create; it cannot re-offer the Create button.
  assert.equal(reduceCanvasPane(failed, { type: 'attached', canvasId: null }), failed);
  assert.equal(reduceCanvasPane(failed, { type: 'attached', canvasId: 'canvas-7' }), failed);

  const retried = apply(failed, { type: 'creating' }, { type: 'created', canvasId: 'canvas-7' });
  assert.deepEqual(retried, {
    status: 'loading',
    canvasId: 'canvas-7',
  });
});

test('a failed read offers a retry that starts the pane over', () => {
  const failed = reduceCanvasPane(initialCanvasPaneState(null), {
    type: 'failed',
    message: 'The runtime did not answer that Canvas request.',
  });
  assert.deepEqual(failed, {
    status: 'failed',
    message: 'The runtime did not answer that Canvas request.',
  });
  assert.deepEqual(reduceCanvasPane(failed, { type: 'reopened' }), { status: 'opening' });
});

test('the source drawer follows its frame and closes when the frame is gone', () => {
  const ready = apply(initialCanvasPaneState('canvas-1'), {
    type: 'snapshot',
    snapshot: snapshot(4, ['Pricing', 'Hey']),
  });
  assert.equal(openSourceFrame(ready), null);

  const open = reduceCanvasPane(ready, openSourcePanel('design-1'));
  assert.equal(openSourceFrame(open)?.name, 'Hey');

  // A change on the board leaves the drawer on its own frame.
  const moved = reduceCanvasPane(open, {
    type: 'snapshot',
    snapshot: snapshot(5, ['Pricing', 'Hi']),
  });
  assert.equal(openSourceFrame(moved)?.name, 'Hi');

  // The frame leaving the board closes the drawer rather than showing nothing.
  const removed = reduceCanvasPane(moved, { type: 'snapshot', snapshot: snapshot(6, ['Pricing']) });
  assert.equal(openSourceFrame(removed), null);

  assert.equal(openSourceFrame(reduceCanvasPane(open, { type: 'close-source' })), null);
  // A pane with no board has no drawer to open.
  assert.equal(
    reduceCanvasPane({ status: 'opening' }, openSourcePanel('design-1')).status,
    'opening',
  );
});
