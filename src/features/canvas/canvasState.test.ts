import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialCanvasPaneState,
  openSourceFrame,
  openSourcePanel,
  reduceCanvasPane,
  reduceBoardInteraction,
  SELECT_MODE,
  type BoardInteraction,
  type BoardInteractionEvent,
  watchedCanvasId,
  type CanvasPaneState,
  outdatedCanvasMessage,
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

  const creating = reduceCanvasPane(unattached, { type: 'attaching' });
  assert.equal(creating.status, 'attaching');
  assert.equal(watchedCanvasId(creating), null);
  assert.equal(
    watchedCanvasId(reduceCanvasPane(creating, { type: 'settled', canvasId: 'canvas-1' })),
    'canvas-1',
  );
});

test('a chat whose canvas an earlier DROIDEX made is unattached and says which it was', () => {
  const outdated = reduceCanvasPane(initialCanvasPaneState(null), {
    type: 'attached',
    canvasId: null,
    outdatedName: 'Pricing',
  });
  assert.deepEqual(outdated, { status: 'unattached', error: '', outdatedName: 'Pricing' });
  // Asking again keeps what the pane already says, and a new canvas replaces it.
  assert.equal(
    reduceCanvasPane(outdated, { type: 'attached', canvasId: null, outdatedName: 'Pricing' }),
    outdated,
  );
  assert.equal(reduceCanvasPane(outdated, { type: 'settled', canvasId: 'cv_2' }).status, 'loading');
  // Its name is often a whole first prompt, so only the start is quoted.
  assert.match(outdatedCanvasMessage('Pricing'), /^“Pricing” was made by an earlier DROIDEX/);
  assert.match(outdatedCanvasMessage('x'.repeat(60)), /^“x{47}…” was made/);
});

test('reopening a pane with an unsettled attachment keeps recovery ahead of the cache', () => {
  assert.deepEqual(initialCanvasPaneState('canvas-old', 'Canvas creation may still be running.'), {
    status: 'attach-recovering',
    message: 'Canvas creation may still be running.',
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
    { type: 'attaching' },
    { type: 'attach-failed', message: 'DROIDEX is not connected.' },
  );
  assert.deepEqual(failed, { status: 'attach-recovering', message: 'DROIDEX is not connected.' });

  // A read can race an unsettled Create; it cannot re-offer the Create button.
  assert.equal(reduceCanvasPane(failed, { type: 'attached', canvasId: null }), failed);
  assert.equal(reduceCanvasPane(failed, { type: 'attached', canvasId: 'canvas-7' }), failed);

  const retried = apply(failed, { type: 'attaching' }, { type: 'settled', canvasId: 'canvas-7' });
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

function pick(state: BoardInteraction, ...events: BoardInteractionEvent[]): BoardInteraction {
  return events.reduce(reduceBoardInteraction, state);
}

test('clicking picks one frame and shift-clicking builds and unpicks a selection', () => {
  const one = reduceBoardInteraction(SELECT_MODE, { type: 'pick', designId: 'a', additive: false });
  assert.deepEqual(one.selectedFrameIds, ['a']);
  assert.equal(one.mode, 'select');

  // A plain click replaces the selection; shift-click toggles membership, in
  // the order the user picked.
  assert.deepEqual(pick(one, { type: 'pick', designId: 'b', additive: false }).selectedFrameIds, [
    'b',
  ]);
  const several = pick(
    one,
    { type: 'pick', designId: 'c', additive: true },
    { type: 'pick', designId: 'b', additive: true },
  );
  assert.deepEqual(several.selectedFrameIds, ['a', 'c', 'b']);
  assert.deepEqual(
    reduceBoardInteraction(several, { type: 'pick', designId: 'c', additive: true })
      .selectedFrameIds,
    ['a', 'b'],
  );

  // Re-picking the frame already selected alone is not a change, so nothing
  // downstream of this state has to re-render for it.
  assert.equal(reduceBoardInteraction(one, { type: 'pick', designId: 'a', additive: false }), one);
  assert.equal(reduceBoardInteraction(SELECT_MODE, { type: 'clear' }), SELECT_MODE);
});

test('a rubber band selects what it covered, and adds to the selection with Shift', () => {
  const band = reduceBoardInteraction(SELECT_MODE, {
    type: 'pick-band',
    designIds: ['b', 'c'],
    additive: false,
  });
  assert.deepEqual(band.selectedFrameIds, ['b', 'c']);

  // An additive band adds only what was not already picked.
  assert.deepEqual(
    reduceBoardInteraction(band, { type: 'pick-band', designIds: ['c', 'd'], additive: true })
      .selectedFrameIds,
    ['b', 'c', 'd'],
  );
  assert.deepEqual(
    reduceBoardInteraction(band, { type: 'pick-band', designIds: [], additive: false })
      .selectedFrameIds,
    [],
  );
});

test('Enter interacts with one frame and Escape leaves Interact before it clears', () => {
  const interacting = pick(
    SELECT_MODE,
    { type: 'pick', designId: 'a', additive: false },
    { type: 'interact', designId: 'a' },
  );
  assert.deepEqual(interacting, {
    mode: 'interact',
    selectedFrameIds: ['a'],
    interactedFrameId: 'a',
  });

  // Spec §4: Escape returns to selection, and Escape again clears it. The two
  // steps out of Interact are never one.
  const selected = reduceBoardInteraction(interacting, { type: 'escape' });
  assert.deepEqual(selected, { mode: 'select', selectedFrameIds: ['a'], interactedFrameId: null });
  assert.deepEqual(reduceBoardInteraction(selected, { type: 'escape' }), SELECT_MODE);
  assert.equal(reduceBoardInteraction(SELECT_MODE, { type: 'escape' }), SELECT_MODE);
});

test('Interact follows a frame picked while it runs, and lets go of a multiple selection', () => {
  const interacting = reduceBoardInteraction(SELECT_MODE, { type: 'interact', designId: 'a' });

  // Picking another frame keeps the live slot under the hand.
  const moved = reduceBoardInteraction(interacting, {
    type: 'pick',
    designId: 'b',
    additive: false,
  });
  assert.deepEqual(moved, { mode: 'interact', selectedFrameIds: ['b'], interactedFrameId: 'b' });

  // Interact drives one frame, so picking several leaves it.
  const many = reduceBoardInteraction(moved, { type: 'pick', designId: 'c', additive: true });
  assert.deepEqual(many, {
    mode: 'select',
    selectedFrameIds: ['b', 'c'],
    interactedFrameId: null,
  });
  assert.deepEqual(reduceBoardInteraction(interacting, { type: 'clear' }), SELECT_MODE);
});

test('nothing points at a frame the canvas has lost', () => {
  const interacting = pick(
    SELECT_MODE,
    { type: 'pick', designId: 'a', additive: false },
    { type: 'pick', designId: 'b', additive: true },
    { type: 'interact', designId: 'b' },
  );

  const deleted = reduceBoardInteraction(interacting, { type: 'frames', designIds: ['a'] });
  assert.deepEqual(deleted, { mode: 'select', selectedFrameIds: [], interactedFrameId: null });

  // A snapshot that still holds every selected frame changes nothing at all.
  const two = pick(
    SELECT_MODE,
    { type: 'pick', designId: 'a', additive: false },
    { type: 'pick', designId: 'b', additive: true },
  );
  assert.equal(reduceBoardInteraction(two, { type: 'frames', designIds: ['a', 'b', 'c'] }), two);
});
