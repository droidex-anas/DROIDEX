import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionFileChange } from './sessionFileCache.js';
import { SessionFileServing } from './SessionFileServing.js';
import type { SessionFileWatcherOptions } from './sessionFileWatcher.js';
import type { SessionListFilterOptions } from './sessionListFilter.js';

function gate() {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function createServing() {
  const watchers: SessionFileWatcherOptions[] = [];
  const targeted: SessionFileChange[][] = [];
  const emitted: (SessionListFilterOptions | undefined)[] = [];
  const state = {
    fullReconciles: 0,
    shutdown: false,
    fullGate: undefined as Promise<void> | undefined,
    targetedGate: undefined as Promise<void> | undefined,
    failNextFull: undefined as Error | undefined,
    failNextTargeted: undefined as Error | undefined,
    watchersClosed: 0,
  };
  let listedWith: SessionListFilterOptions | undefined;
  const serving = new SessionFileServing({
    history: {
      async reconcileSessionFiles() {
        state.fullReconciles += 1;
        await state.fullGate;
        const failure = state.failNextFull;
        state.failNextFull = undefined;
        if (failure) throw failure;
        return 0;
      },
      async reconcileSessionFilePaths(changes) {
        targeted.push(changes);
        await state.targetedGate;
        const failure = state.failNextTargeted;
        state.failNextTargeted = undefined;
        if (failure) throw failure;
        return changes.length;
      },
    },
    startWatcher: (options) => {
      watchers.push(options);
      return {
        liveSessionFile: () => undefined,
        consumeLiveSessionFile: () => undefined,
        close: () => {
          state.watchersClosed += 1;
        },
      };
    },
    isLiveSession: () => false,
    isShutdownStarted: () => state.shutdown,
    retryPendingLaunchSettings: () => undefined,
    listSummaries: (options) => {
      listedWith = options;
      return { sessions: [], earlierSessionsByCwd: {} };
    },
    emitList: () => {
      emitted.push(listedWith);
    },
  });
  const fire = (changes: SessionFileChange[] | null): void => {
    assert.ok(watchers[0], 'the watchers start with the first list');
    watchers[0].onExternalChange(changes);
  };
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { serving, watchers, targeted, emitted, state, fire, settle };
}

const change = (id: string): SessionFileChange => ({
  providerSessionId: id,
  path: `/tmp/${id}.jsonl`,
});

test('the first list waits for the one boot reconcile, and watchers start once per root', async () => {
  const h = createServing();
  const boot = gate();
  h.state.fullGate = boot.promise;
  let listed = false;
  const first = h.serving.list({}).then(() => {
    listed = true;
  });
  await h.settle();
  assert.equal(listed, false);
  assert.deepEqual(h.emitted, []);

  boot.open();
  await first;
  await h.serving.list({});
  await h.serving.list({});

  assert.equal(h.state.fullReconciles, 1, 'only the boot reconcile walks the tree');
  assert.equal(h.emitted.length, 3, 'lists after the boot reconcile are served immediately');
  // One per scanned session-file root: Droid's tree and the provider transcripts.
  assert.equal(h.watchers.length, 2);
  assert.equal(new Set(h.watchers.map((watcher) => watcher.root)).size, 2);
});

test('lists queued during the boot reconcile emit once, with the latest filter', async () => {
  const h = createServing();
  const boot = gate();
  h.state.fullGate = boot.promise;
  const first = { workspaceCwds: ['/tmp/first'] };
  const second = { workspaceCwds: ['/tmp/second'] };
  const listing = Promise.all([h.serving.list(first), h.serving.list(second)]);
  boot.open();
  await listing;

  assert.deepEqual(h.emitted, [second]);
  assert.equal(h.state.fullReconciles, 1);
});

test('a failed boot reconcile rejects the list and the next list retries it', async () => {
  const h = createServing();
  h.state.failNextFull = new Error('sqlite busy');
  await assert.rejects(h.serving.list({}), /sqlite busy/);
  assert.deepEqual(h.emitted, [], 'a failed authoritative reconcile never publishes');

  await h.serving.list({});
  assert.equal(h.emitted.length, 1);
  assert.equal(h.state.fullReconciles, 2);
});

test('a watcher change during the boot reconcile is replayed after it, before the first list', async () => {
  const h = createServing();
  const boot = gate();
  h.state.fullGate = boot.promise;
  const listing = h.serving.list({ workspaceCwds: ['/tmp/boot-window'] });
  // The boot scan may already have passed the changed path, so the change is
  // held and replayed rather than reconciled inside the boot window.
  h.fire([change('boot-window-session')]);
  assert.deepEqual(h.targeted, []);
  boot.open();
  await listing;

  assert.deepEqual(h.targeted, [[change('boot-window-session')]]);
  assert.equal(h.state.fullReconciles, 1);
  assert.equal(h.emitted.length, 1, 'only the authoritative boot list is emitted');
});

test('watcher changes reconcile exactly the reported files, or the whole tree when unexplained', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const h = createServing();
  const filter = { workspaceCwds: ['/tmp/external-workspace'] };
  await h.serving.list(filter);

  h.fire([change('external-1'), change('external-2')]);
  await h.settle();
  assert.deepEqual(h.targeted, [[change('external-1'), change('external-2')]]);
  assert.deepEqual(h.emitted, [filter, filter], 'a change republishes the last requested list');

  h.fire(null);
  await h.settle();
  assert.equal(h.state.fullReconciles, 2);
  assert.equal(h.targeted.length, 1);
  assert.equal(h.emitted.length, 3);
});

test('a failed watcher reconcile publishes nothing and makes the next list a full retry', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const h = createServing();
  await h.serving.list({});
  h.state.failNextTargeted = new Error('derived database busy');
  h.fire([change('failed-watcher-session')]);
  await h.settle();

  assert.equal(h.emitted.length, 1, 'a failed delta never republishes a stale list');
  await h.serving.list({});
  assert.equal(h.state.fullReconciles, 2, 'the next list performs a full retry');
  assert.equal(h.emitted.length, 2);
});

test('close waits for an active watcher reconcile and shutdown suppresses its republish', async () => {
  const h = createServing();
  await h.serving.list({});
  const reconcile = gate();
  h.state.targetedGate = reconcile.promise;
  h.fire([change('external-during-shutdown')]);
  await h.settle();

  h.state.shutdown = true;
  let closed = false;
  const closing = h.serving.close().then(() => {
    closed = true;
  });
  await h.settle();
  assert.equal(closed, false, 'history stays open until the active reconcile settles');
  assert.equal(h.state.watchersClosed, 2);

  reconcile.open();
  await closing;
  assert.equal(h.emitted.length, 1, 'a reconcile finishing during shutdown publishes nothing');
});

test('whenBootReconciled shares the in-flight boot reconcile without publishing a list', async () => {
  const h = createServing();
  const boot = gate();
  h.state.fullGate = boot.promise;
  h.serving.start();
  let settled = false;
  const ready = h.serving.whenBootReconciled().then(() => {
    settled = true;
  });
  await h.settle();
  assert.equal(settled, false);
  boot.open();
  await ready;
  assert.deepEqual(h.emitted, []);
  assert.equal(h.state.fullReconciles, 1, 'start and restore share one boot reconcile');
});
