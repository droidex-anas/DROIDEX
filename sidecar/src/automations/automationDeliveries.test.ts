import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { sessionSummary } from '../testing/sessionSummaryFixture.js';
import { AutomationManager } from './AutomationManager.js';
import { parseAutomationStore } from './automationStoreParsing.js';
import type { AutomationInput, AutomationSnapshot } from './types.js';

type Options = ConstructorParameters<typeof AutomationManager>[0];

const bounded = { timeout: 10_000 };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Records each published snapshot so a test can wait for the one it expects. */
function snapshots() {
  let latest: AutomationSnapshot | undefined;
  const waiters = new Set<() => void>();
  return {
    emit: (event: Parameters<Options['emit']>[0]) => {
      if (event.type !== 'automations.snapshot') return;
      latest = event.snapshot;
      for (const notify of waiters) notify();
    },
    until: (predicate: (snapshot: AutomationSnapshot) => boolean): Promise<AutomationSnapshot> => {
      if (latest && predicate(latest)) return Promise.resolve(latest);
      return new Promise((resolve) => {
        const notify = () => {
          if (!latest || !predicate(latest)) return;
          waiters.delete(notify);
          resolve(latest);
        };
        waiters.add(notify);
      });
    },
  };
}

/**
 * A manager for messages to existing chats, over a scratch data directory.
 * `restart` opens a second manager on the same directory, as a restarted
 * sidecar would. Everything is shut down and removed when the test ends.
 */
async function harness(t: TestContext, options: Partial<Options> = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'scheduled-messages-')));
  const managers: AutomationManager[] = [];
  t.after(async () => {
    for (const opened of managers.reverse()) await opened.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const open = (overrides: Partial<Options>) => {
    const published = snapshots();
    const manager = new AutomationManager({
      dataDir: directory,
      launchSession: async () => {
        throw new Error('Existing messages must not launch a new chat.');
      },
      prepareWorkspace: async () => {
        throw new Error('Existing messages must not prepare a workspace.');
      },
      closeSession: async () => {
        throw new Error('Existing messages must not close their target.');
      },
      validateSelection: async () => {
        throw new Error('Existing messages use the target settings.');
      },
      deliverMessage: async () => ({ status: 'accepted', settled: Promise.resolve() }),
      ...overrides,
      emit: published.emit,
    });
    managers.push(manager);
    return { manager, until: published.until };
  };
  const { manager, until } = open(options);
  await manager.waitUntilReady();
  return { manager, directory, until, restart: open };
}

function message(
  appSessionId = 'exact-session',
  overrides: Partial<AutomationInput> = {},
): AutomationInput {
  return {
    target: { kind: 'existing-session', appSessionId },
    title: 'Later message',
    prompt: 'Follow up using the current conversation.',
    enabled: false,
    schedule: { kind: 'once', runAt: 2_000 },
    timezone: 'UTC',
    ...overrides,
  };
}

test(
  'existing delivery bypasses new-chat ownership and completes at acceptance',
  bounded,
  async (t) => {
    const turn = deferred<void>();
    t.after(() => turn.resolve());
    const delivered: string[] = [];
    const h = await harness(t, {
      deliverMessage: async (id, prompt, isCurrent) => {
        assert.equal(isCurrent(), true);
        delivered.push(id, prompt);
        return { status: 'accepted', settled: turn.promise };
      },
    });
    const automation = await h.manager.create(message());
    await h.manager.runNow(automation.id);
    const snapshot = await h.until((value) => value.runs[0]?.status === 'completed');
    assert.deepEqual(delivered, ['exact-session', automation.prompt]);
    assert.equal(snapshot.runs[0]?.appSessionId, 'exact-session');
    assert.deepEqual(snapshot.sessionOrigins, {});
    assert.equal(h.manager.isRunSession('exact-session'), false);
    await h.manager.observeSessionEvent({ type: 'session.closed', appSessionId: 'exact-session' });
    assert.equal((await h.manager.snapshot()).runs[0]?.status, 'completed');
  },
);

test(
  'existing-session messages bypass an occupied new-session automation slot',
  bounded,
  async (t) => {
    const launched = deferred<void>();
    const h = await harness(t, {
      validateSelection: async () => undefined,
      prepareWorkspace: async () => '',
      launchSession: async () => {
        launched.resolve();
      },
    });
    const fresh = await h.manager.create(
      message('unused', {
        target: { kind: 'new-session' },
        modelId: 'model',
        reasoningEffort: 'high',
      }),
    );
    await h.manager.runNow(fresh.id);
    await launched.promise;
    const existing = await h.manager.create(message());
    await h.manager.runNow(existing.id);
    const snapshot = await h.until((value) =>
      value.runs.some((run) => run.automationId === existing.id && run.status === 'completed'),
    );
    assert.equal(snapshot.runs.find((run) => run.automationId === fresh.id)?.status, 'starting');
  },
);

test(
  'busy due messages are persisted, cancelable, and never entered into a volatile send queue',
  bounded,
  async (t) => {
    let clock = 1_000;
    let attempts = 0;
    const h = await harness(t, {
      now: () => clock,
      deliverMessage: async () => {
        attempts += 1;
        return { status: 'busy', retryOn: 'target' };
      },
    });
    const automation = await h.manager.create(message('busy', { enabled: true }));
    clock = 3_000;
    await h.manager.update(automation.id, { title: 'Due' });
    await h.until((value) => value.automations[0]?.lastRunStatus === 'queued');
    const disk = parseAutomationStore(
      JSON.parse(await readFile(join(h.directory, 'automations.json'), 'utf8')),
      clock,
    );
    assert.equal(disk.runs[0]?.status, 'queued');
    assert.equal(attempts, 1);
    const session = sessionSummary({
      appSessionId: 'busy',
      providerSessionId: undefined,
      phase: 'running',
      streaming: true,
      updatedAt: clock,
    });
    await h.manager.observeSessionEvent({ type: 'session.updated', session });
    // A serialized catalog write drains any delivery write triggered by telemetry.
    await h.manager.update(automation.id, { title: 'Still busy' });
    assert.equal(attempts, 1);
    await h.manager.observeSessionEvent({
      type: 'session.updated',
      session: { ...session, streaming: false },
    });
    await h.until((value) => value.automations[0]?.lastRunStatus === 'queued' && attempts === 2);
    await h.manager.setEnabled(automation.id, false);
    assert.equal((await h.manager.snapshot()).queuedRunCount, 0);
    await h.manager.remove(automation.id);
    await h.manager.observeSessionEvent({ type: 'session.closed', appSessionId: 'busy' });
    assert.equal(attempts, 2);
  },
);

test('a slot released while two attempts run rearms both of them', bounded, async (t) => {
  const entered: (() => void)[] = [];
  const release = deferred<void>();
  t.after(() => release.resolve());
  let capacityRefusals = 0;
  const h = await harness(t, {
    deliverMessage: async () => {
      if (capacityRefusals >= 2) return { status: 'accepted', settled: Promise.resolve() };
      capacityRefusals += 1;
      entered.shift()?.();
      await release.promise;
      return { status: 'busy', retryOn: 'capacity' };
    },
  });
  const first = deferred<void>();
  const second = deferred<void>();
  entered.push(first.resolve, second.resolve);
  const one = await h.manager.create(message('one'));
  const two = await h.manager.create(message('two'));
  await h.manager.runNow(one.id);
  await h.manager.runNow(two.id);
  await first.promise;
  await second.promise;

  // The slot frees while both attempts are still waiting on their receipt.
  await h.manager.observeSchedulingCapacity();
  release.resolve();

  // Neither may park on a capacity check the release already invalidated, so
  // both drain without a further capacity or session signal.
  await h.until((snapshot) => snapshot.runs.every((run) => run.status === 'completed'));
  assert.equal(capacityRefusals, 2);
});

test('availability racing a busy receipt rearms the exact target once', async (t) => {
  const entered = deferred<void>();
  const blocked = deferred<void>();
  t.after(() => blocked.resolve());
  let attempts = 0;
  const h = await harness(t, {
    deliverMessage: async () => {
      attempts += 1;
      if (attempts > 1) return { status: 'accepted', settled: Promise.resolve() };
      entered.resolve();
      await blocked.promise;
      return { status: 'busy', retryOn: 'target' };
    },
  });
  const automation = await h.manager.create(message());
  await h.manager.runNow(automation.id);
  await entered.promise;
  await h.manager.observeSessionAvailability('other-session');
  assert.equal(attempts, 1);
  await h.manager.observeSessionAvailability('exact-session');
  blocked.resolve();
  await h.until((snapshot) => snapshot.runs[0]?.status === 'completed');
  assert.equal(attempts, 2);
});

test(
  'starting is durable before the adapter runs and restart never replays an ambiguous delivery',
  bounded,
  async (t) => {
    const attempted = deferred<void>();
    const blocked = deferred<void>();
    t.after(() => blocked.resolve());
    const h = await harness(t, {
      deliverMessage: async () => {
        attempted.resolve();
        await blocked.promise;
        return { status: 'busy', retryOn: 'target' };
      },
    });
    const automation = await h.manager.create(message());
    await h.manager.runNow(automation.id);
    await attempted.promise;
    const persisted = await readFile(join(h.directory, 'automations.json'), 'utf8');
    assert.equal(parseAutomationStore(JSON.parse(persisted), 3_000).runs[0]?.status, 'starting');
    const shutdown = h.manager.shutdown();
    blocked.resolve();
    await shutdown;
    // Simulate the exact crash image, without running two writers concurrently.
    await writeFile(join(h.directory, 'automations.json'), persisted);
    const { manager: restarted } = h.restart({
      deliverMessage: async () => {
        assert.fail('An ambiguous attempt must not be replayed');
      },
    });
    const snapshot = await restarted.snapshot();
    assert.equal(snapshot.runs[0]?.status, 'failed');
    assert.match(
      snapshot.runs[0]?.error ?? '',
      /outcome unknown; inspect conversation before retrying/i,
    );
  },
);

test(
  'queued deliveries recover on startup and unavailable targets fail without replacement',
  bounded,
  async (t) => {
    const h = await harness(t, {
      deliverMessage: async () => ({ status: 'busy', retryOn: 'target' }),
    });
    const automation = await h.manager.create(message());
    await h.manager.runNow(automation.id);
    await h.until((value) => value.automations[0]?.lastRunStatus === 'queued');
    await h.manager.shutdown();
    const restarted = h.restart({
      deliverMessage: async (id) => {
        assert.equal(id, 'exact-session');
        return { status: 'unavailable', error: 'Target was deleted.' };
      },
    });
    const failed = await restarted.until((value) => value.runs[0]?.status === 'failed');
    assert.equal(failed.runs[0]?.error, 'Target was deleted.');
  },
);

test(
  'at most two scheduled turns run concurrently and the same target is excluded until settlement',
  bounded,
  async (t) => {
    const turns = [deferred<void>(), deferred<void>(), deferred<void>()];
    t.after(() => {
      for (const turn of turns) turn.resolve();
    });
    const accepted: string[] = [];
    const h = await harness(t, {
      deliverMessage: async (id) => {
        const turn = turns[accepted.length];
        assert.ok(turn);
        accepted.push(id);
        return { status: 'accepted', settled: turn.promise };
      },
    });
    const first = await h.manager.create(message('first'));
    const duplicate = await h.manager.create(message('first'));
    const second = await h.manager.create(message('second'));
    await h.manager.runNow(first.id);
    await h.until((value) =>
      value.runs.some((run) => run.automationId === first.id && run.status === 'completed'),
    );
    await h.manager.runNow(duplicate.id);
    await h.manager.runNow(second.id);
    await h.until((value) =>
      value.runs.some((run) => run.automationId === second.id && run.status === 'completed'),
    );
    assert.deepEqual(accepted, ['first', 'second']);
    turns[0]?.resolve();
    await h.until((value) => value.runs.every((run) => run.status === 'completed'));
    assert.deepEqual(accepted, ['first', 'second', 'first']);
  },
);

test(
  'saved attachments are snapshots that outlive their sources and a restart, and go with their definition',
  bounded,
  async (t) => {
    const h = await harness(t);
    const sources = [join(h.directory, 'first.txt'), join(h.directory, 'second.txt')];
    await Promise.all(sources.map((path, index) => writeFile(path, `snapshot ${String(index)}`)));
    const automation = await h.manager.create(message('files', { files: sources }));
    const saved = automation.files;
    assert.equal(saved.length, 2);
    assert.ok(saved.every((path, index) => path !== sources[index]));
    // Neither a changed nor a deleted source reaches the saved copy, and an
    // unrelated edit keeps the same copies rather than taking new ones.
    await writeFile(sources[0] ?? '', 'changed content');
    await rm(sources[1] ?? '');
    assert.deepEqual((await h.manager.update(automation.id, { title: 'Renamed' })).files, saved);
    await h.manager.shutdown();

    const restarted = h.restart({
      deliverMessage: async (id, prompt) => {
        assert.equal(id, 'files');
        assert.equal(
          prompt,
          `${automation.prompt}\n\n${saved.map((path) => `@${path}`).join('\n')}`,
        );
        assert.deepEqual(await Promise.all(saved.map((path) => readFile(path, 'utf8'))), [
          'snapshot 0',
          'snapshot 1',
        ]);
        return { status: 'accepted', settled: Promise.resolve() };
      },
    });
    await restarted.manager.runNow(automation.id);
    await restarted.until((value) => value.runs[0]?.status === 'completed');

    // Dropping them from the definition keeps the copies the run referenced;
    // deleting the definition removes them, never the user's own file.
    await restarted.manager.update(automation.id, { files: [] });
    assert.equal(await readFile(saved[0] ?? '', 'utf8'), 'snapshot 0');
    await restarted.manager.remove(automation.id);
    await assert.rejects(readFile(saved[0] ?? ''), { code: 'ENOENT' });
    assert.equal(await readFile(sources[0] ?? '', 'utf8'), 'changed content');
  },
);

test(
  'one-shot targets reject recurrence and unsafe attachments without saving a definition',
  bounded,
  async (t) => {
    const h = await harness(t);
    await assert.rejects(
      h.manager.create(message('target', { schedule: { kind: 'daily', time: '09:00' } })),
      /must run once/,
    );
    await assert.rejects(
      h.manager.create(message('target', { files: ['relative.txt'] })),
      /absolute/,
    );
    const source = join(h.directory, 'source.txt');
    const link = join(h.directory, 'symlink.txt');
    await writeFile(source, 'source');
    await symlink(source, link);
    await assert.rejects(h.manager.create(message('target', { files: [link] })), /regular files/);
    assert.equal((await h.manager.snapshot()).automations.length, 0);
    assert.equal(await readFile(source, 'utf8'), 'source');
  },
);

test(
  'queued manual deliveries can be deleted or paused without touching their targets',
  bounded,
  async (t) => {
    let attempts = 0;
    const h = await harness(t, {
      deliverMessage: async () => {
        attempts += 1;
        return { status: 'busy', retryOn: 'target' };
      },
    });
    const deleted = await h.manager.create(message('deleted'));
    await h.manager.runNow(deleted.id);
    await h.until((snapshot) => snapshot.automations[0]?.lastRunStatus === 'queued');
    await h.manager.remove(deleted.id);
    const paused = await h.manager.create(message('paused'));
    await h.manager.runNow(paused.id);
    await h.until((snapshot) => snapshot.automations[0]?.lastRunStatus === 'queued');
    await h.manager.setEnabled(paused.id, false);
    await h.manager.observeSessionEvent({ type: 'session.closed', appSessionId: 'paused' });
    await h.manager.observeSessionEvent({ type: 'session.closed', appSessionId: 'deleted' });
    assert.equal(attempts, 2);
    const snapshot = await h.manager.snapshot();
    assert.deepEqual(snapshot.runs, []);
    assert.equal(snapshot.automations[0]?.lastRunStatus, null);
  },
);

test(
  'pausing during setup invalidates the attempt before send and allows deletion',
  bounded,
  async (t) => {
    const setup = deferred<void>();
    t.after(() => setup.resolve());
    const entered = deferred<void>();
    const finished = deferred<void>();
    let sent = false;
    const h = await harness(t, {
      deliverMessage: async (_id, _prompt, isCurrent) => {
        entered.resolve();
        await setup.promise;
        sent = isCurrent();
        finished.resolve();
        return { status: 'unavailable', error: 'Canceled before send' };
      },
    });
    const automation = await h.manager.create(message());
    await h.manager.runNow(automation.id);
    await entered.promise;
    await assert.rejects(h.manager.remove(automation.id), /active automation run/);
    await h.manager.setEnabled(automation.id, false);
    await h.manager.remove(automation.id);
    setup.resolve();
    await finished.promise;
    assert.equal(sent, false);
    assert.deepEqual((await h.manager.snapshot()).runs, []);
  },
);

test(
  'deleting an accepted delivery retains its attachments until the borrowed turn settles',
  bounded,
  async (t) => {
    const turn = deferred<void>();
    t.after(() => turn.resolve());
    const h = await harness(t, {
      deliverMessage: async () => ({ status: 'accepted', settled: turn.promise }),
    });
    const source = join(h.directory, 'in-use.txt');
    await writeFile(source, 'read later in the turn');
    const automation = await h.manager.create(message('target', { files: [source] }));
    const saved = automation.files[0];
    assert.ok(saved);
    await h.manager.runNow(automation.id);
    await h.until((snapshot) => snapshot.runs[0]?.status === 'completed');
    const next = await h.manager.create(message('target'));
    await h.manager.runNow(next.id);
    await h.manager.remove(automation.id);
    assert.equal(await readFile(saved, 'utf8'), 'read later in the turn');
    turn.resolve();
    await h.until((snapshot) =>
      snapshot.runs.some((run) => run.automationId === next.id && run.status === 'completed'),
    );
    await assert.rejects(readFile(saved), { code: 'ENOENT' });
    assert.equal(await readFile(source, 'utf8'), 'read later in the turn');
  },
);

test(
  'attachment-only bridge input survives persistence and reaches the delivery prompt',
  bounded,
  async (t) => {
    let delivered = '';
    const h = await harness(t, {
      deliverMessage: async (_id, prompt) => {
        delivered = prompt;
        return { status: 'accepted', settled: Promise.resolve() };
      },
    });
    const source = join(h.directory, 'attachment-only.txt');
    await writeFile(source, 'Instructions from a file');
    await h.manager.handleBridgeCommand({
      type: 'automations.create',
      requestId: 'attachment-only',
      input: message('target', { prompt: '', files: [source] }),
    });
    const automation = (await h.manager.snapshot()).automations[0];
    assert.ok(automation);
    const persisted = parseAutomationStore(
      JSON.parse(await readFile(join(h.directory, 'automations.json'), 'utf8')),
      1_000,
    );
    assert.equal(persisted.automations[0]?.prompt, '');
    assert.deepEqual(persisted.automations[0]?.files, automation.files);
    await h.manager.runNow(automation.id);
    await h.until((snapshot) => snapshot.runs[0]?.status === 'completed');
    assert.equal(delivered.trim(), `@${automation.files[0]}`);
    await assert.rejects(
      h.manager.create(message('empty', { prompt: '', files: [] })),
      /instructions or attachments/,
    );
  },
);
