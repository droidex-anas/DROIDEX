import assert from 'node:assert/strict';
import test from 'node:test';

import { ChildHistoryWatch } from './ChildHistoryWatch.js';
import type { ChildIdentity } from './ChildSessionState.js';

function gate() {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const identity = { parentAppSessionId: 'parent', childSessionId: 'child' };
const change = (providerSessionId: string) => ({ providerSessionId, path: '/tmp/child.jsonl' });

function createHarness() {
  const emitted: ChildIdentity[] = [];
  const errors: unknown[] = [];
  const state = {
    current: true,
    available: true,
    generation: 0,
    providerIds: new Set(['provider-child']),
    readiness: Promise.resolve(),
    readGate: Promise.resolve(),
    reads: 0,
    readinessCalls: 0,
  };
  const watch = new ChildHistoryWatch({
    fileHistorySource: (target) => {
      if (!state.available) return undefined;
      const generation = state.generation;
      return {
        isCurrent: () => state.current && state.generation === generation,
        containsProvider: (id) => state.providerIds.has(id),
        refresh: async (isSelected) => {
          state.reads += 1;
          await state.readGate;
          if (state.current && state.generation === generation && isSelected())
            emitted.push(target);
        },
      };
    },
    whenHistoryReady: () => {
      state.readinessCalls += 1;
      return state.readiness;
    },
    reportError: (_target, error) => errors.push(error),
  });
  const select = (owner: object, requestId: string, target: ChildIdentity | null = identity) =>
    watch.set(owner, { type: 'child.watchHistory', requestId, target });
  return { watch, select, emitted, errors, state };
}

test('the selected file source refreshes after readiness and coalesces matching changes during a read', async () => {
  const h = createHarness();
  const ready = gate();
  const reading = gate();
  h.state.readiness = ready.promise;
  h.state.readGate = reading.promise;
  h.select({}, 'selected');
  h.watch.filesReconciled([change('provider-child')]);
  assert.equal(h.state.reads, 0);

  ready.open();
  await settle();
  assert.equal(h.state.reads, 1, 'the initial read includes the change during readiness');
  h.watch.filesReconciled([change('parent')]);
  h.watch.filesReconciled([change('sibling')]);
  assert.equal(h.state.reads, 1);
  h.state.providerIds.add('provider-compacted');
  for (let index = 0; index < 3; index += 1)
    h.watch.filesReconciled([change('provider-compacted')]);
  reading.open();
  await settle();
  assert.equal(h.state.reads, 2, 'matching writes during one read require one further pass');
  assert.deepEqual(h.emitted, [identity, identity]);
  h.watch.close();
  h.watch.filesReconciled(null);
  await settle();
  assert.equal(h.state.reads, 2);
});

test('socket ownership and request identity prevent old disconnects and same-target cleanup from stopping a new watch', async () => {
  const h = createHarness();
  const reading = gate();
  h.state.readGate = reading.promise;
  const oldOwner = {};
  const newOwner = {};
  h.select(oldOwner, 'old');
  await settle();
  h.select(newOwner, 'new');
  h.watch.clearOwner(oldOwner);
  h.select(newOwner, 'old', null);
  reading.open();
  await settle();
  assert.deepEqual(h.emitted, [identity], 'only the new connection can publish its pending read');

  h.select(newOwner, 'newer');
  h.select(newOwner, 'new', null);
  await settle();
  assert.deepEqual(h.emitted, [identity, identity]);
  h.select(newOwner, 'newer', null);
  h.watch.filesReconciled([change('provider-child')]);
  await settle();
  assert.equal(h.emitted.length, 2);
});

test('parent close and source replacement invalidate pending reads before their awaits finish', async () => {
  const h = createHarness();
  const reading = gate();
  h.state.readGate = reading.promise;
  const owner = {};
  h.select(owner, 'close');
  await settle();
  h.watch.clearParent('other-parent');
  h.watch.clearParent('parent');
  reading.open();
  await settle();
  assert.deepEqual(h.emitted, []);

  const ready = gate();
  h.state.readiness = ready.promise;
  h.select(owner, 'replacement');
  h.state.generation += 1;
  ready.open();
  await settle();
  h.watch.parentAttached('parent');
  h.watch.filesReconciled(null);
  assert.equal(h.state.reads, 1, 'a replaced source never starts its pending read');
  assert.deepEqual(h.errors, []);
});

test('a runtime close drops its pending read and the reopened parent resumes the open pane', async () => {
  const h = createHarness();
  const reading = gate();
  h.state.readGate = reading.promise;
  h.select({}, 'retired');
  await settle();
  h.watch.parentClosing('other-parent');
  h.watch.parentClosing('parent');
  h.state.available = false;
  reading.open();
  await settle();
  assert.deepEqual(h.emitted, [], 'the closing runtime cannot publish its read');

  h.state.available = true;
  h.state.generation += 1;
  h.watch.parentAttached('parent');
  await settle();
  assert.deepEqual(h.emitted, [identity]);
  h.watch.filesReconciled([change('provider-child')]);
  await settle();
  assert.deepEqual(h.emitted, [identity, identity]);
});

test('a failed readiness reports once and retries only after a new file change', async () => {
  const h = createHarness();
  const failed = new Error('history index is unavailable');
  h.state.readiness = Promise.reject(failed);
  h.select({}, 'failure');
  await settle();
  assert.deepEqual(h.errors, [failed]);
  assert.equal(h.state.readinessCalls, 1);
  h.state.readiness = Promise.resolve();
  h.watch.filesReconciled([change('provider-child')]);
  await settle();
  assert.deepEqual(h.emitted, [identity]);
});

test('subscription before provider attachment waits for its source without reviving a closed request', async () => {
  const h = createHarness();
  const owner = {};
  h.state.available = false;
  h.select(owner, 'pending-file');
  await settle();
  assert.equal(h.state.reads, 0);
  h.state.available = true;
  h.watch.filesReconciled([change('provider-child')]);
  await settle();
  assert.deepEqual(h.emitted, [identity]);

  h.state.available = false;
  h.select(owner, 'closed-before-attach');
  h.watch.clearParent('parent');
  h.state.available = true;
  h.watch.parentAttached('parent');
  await settle();
  assert.equal(h.emitted.length, 1);

  h.state.available = false;
  h.select(owner, 'pending-attach');
  h.state.available = true;
  h.watch.parentAttached('other-parent');
  assert.equal(h.emitted.length, 1);
  h.watch.parentAttached('parent');
  await settle();
  assert.deepEqual(h.emitted, [identity, identity]);
});
