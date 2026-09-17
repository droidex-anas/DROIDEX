import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { SessionSummary } from '../protocol.js';
import { AutomationManager } from './AutomationManager.js';
import { parseAutomationStore } from './automationStore.js';
import type { AutomationInput, AutomationSnapshot } from './types.js';

type Options = ConstructorParameters<typeof AutomationManager>[0];

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function harness(options: Partial<Options> = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'scheduled-messages-')));
  let latest: AutomationSnapshot | undefined;
  const waiters = new Set<() => void>();
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
    ...options,
    emit: (event) => {
      options.emit?.(event);
      if (event.type !== 'automations.snapshot') return;
      latest = event.snapshot;
      for (const notify of waiters) notify();
    },
  });
  await manager.waitUntilReady();
  return {
    manager,
    directory,
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
    async close() {
      await manager.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
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
  { timeout: 10_000 },
  async () => {
    const turn = deferred<void>();
    const delivered: string[] = [];
    const h = await harness({
      deliverMessage: async (id, prompt, isCurrent) => {
        assert.equal(isCurrent(), true);
        delivered.push(id, prompt);
        return { status: 'accepted', settled: turn.promise };
      },
    });
    try {
      const automation = await h.manager.create(message());
      await h.manager.runNow(automation.id);
      const snapshot = await h.until((value) => value.runs[0]?.status === 'completed');
      assert.deepEqual(delivered, ['exact-session', automation.prompt]);
      assert.equal(snapshot.runs[0]?.appSessionId, 'exact-session');
      assert.deepEqual(snapshot.sessionOrigins, {});
      assert.equal(h.manager.isRunSession('exact-session'), false);
      await h.manager.observeSessionEvent({
        type: 'session.closed',
        appSessionId: 'exact-session',
      });
      assert.equal((await h.manager.snapshot()).runs[0]?.status, 'completed');
    } finally {
      turn.resolve();
      await h.close();
    }
  },
);

test(
  'existing-session messages bypass an occupied new-session automation slot',
  { timeout: 10_000 },
  async () => {
    const launched = deferred<void>();
    const h = await harness({
      validateSelection: async () => undefined,
      prepareWorkspace: async () => '',
      launchSession: async () => {
        launched.resolve();
      },
    });
    try {
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
    } finally {
      await h.close();
    }
  },
);

test(
  'busy due messages are persisted, cancelable, and never entered into a volatile send queue',
  { timeout: 10_000 },
  async () => {
    let clock = 1_000;
    let attempts = 0;
    const h = await harness({
      now: () => clock,
      deliverMessage: async () => {
        attempts += 1;
        return { status: 'busy', retryOn: 'target' };
      },
    });
    try {
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
      const session: SessionSummary = {
        appSessionId: 'busy',
        provider: 'droid',
        sessionPurpose: 'chat',
        interactionMode: 'auto',
        role: 'primary',
        title: 'Busy conversation',
        goal: '',
        cwd: '',
        autonomy: 'low',
        phase: 'running',
        features: [],
        streaming: true,
        tokensIn: 1_000,
        tokensOut: 100,
        contextTokens: 1_100,
        createdAt: 1,
        updatedAt: clock,
      };
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
    } finally {
      await h.close();
    }
  },
);

test('availability racing a busy receipt rearms the exact target once', async () => {
  const entered = deferred<void>();
  const blocked = deferred<void>();
  let attempts = 0;
  const h = await harness({
    deliverMessage: async () => {
      attempts += 1;
      if (attempts > 1) return { status: 'accepted', settled: Promise.resolve() };
      entered.resolve();
      await blocked.promise;
      return { status: 'busy', retryOn: 'target' };
    },
  });
  try {
    const automation = await h.manager.create(message());
    await h.manager.runNow(automation.id);
    await entered.promise;
    await h.manager.observeSessionAvailability('other-session');
    assert.equal(attempts, 1);
    await h.manager.observeSessionAvailability('exact-session');
    blocked.resolve();
    await h.until((snapshot) => snapshot.runs[0]?.status === 'completed');
    assert.equal(attempts, 2);
  } finally {
    blocked.resolve();
    await h.close();
  }
});

test(
  'starting is durable before the adapter runs and restart never replays an ambiguous delivery',
  { timeout: 10_000 },
  async () => {
    const attempted = deferred<void>();
    const blocked = deferred<void>();
    const h = await harness({
      deliverMessage: async () => {
        attempted.resolve();
        await blocked.promise;
        return { status: 'busy', retryOn: 'target' };
      },
    });
    let restarted: AutomationManager | undefined;
    try {
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
      restarted = new AutomationManager({
        dataDir: h.directory,
        emit: () => undefined,
        launchSession: async () => {
          assert.fail('No replacement session');
        },
        closeSession: async () => {
          assert.fail('The historical target is not owned');
        },
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
    } finally {
      blocked.resolve();
      await restarted?.shutdown();
      await h.close();
    }
  },
);

test(
  'queued deliveries recover on startup and unavailable targets fail without replacement',
  { timeout: 10_000 },
  async () => {
    const h = await harness({
      deliverMessage: async () => ({ status: 'busy', retryOn: 'target' }),
    });
    let restarted: AutomationManager | undefined;
    try {
      const automation = await h.manager.create(message());
      await h.manager.runNow(automation.id);
      await h.until((value) => value.automations[0]?.lastRunStatus === 'queued');
      await h.manager.shutdown();
      const completed = deferred<AutomationSnapshot>();
      restarted = new AutomationManager({
        dataDir: h.directory,
        launchSession: async () => {
          assert.fail('No replacement');
        },
        closeSession: async () => {
          assert.fail('No owned session');
        },
        deliverMessage: async (id) => {
          assert.equal(id, 'exact-session');
          return { status: 'unavailable', error: 'Target was deleted.' };
        },
        emit: (event) => {
          if (
            event.type === 'automations.snapshot' &&
            event.snapshot.runs[0]?.status === 'failed'
          ) {
            completed.resolve(event.snapshot);
          }
        },
      });
      assert.equal((await completed.promise).runs[0]?.error, 'Target was deleted.');
    } finally {
      await restarted?.shutdown();
      await h.close();
    }
  },
);

test(
  'at most two scheduled turns run concurrently and the same target is excluded until settlement',
  { timeout: 10_000 },
  async () => {
    const turns = [deferred<void>(), deferred<void>(), deferred<void>()];
    const accepted: string[] = [];
    const h = await harness({
      deliverMessage: async (id) => {
        const turn = turns[accepted.length];
        assert.ok(turn);
        accepted.push(id);
        return { status: 'accepted', settled: turn.promise };
      },
    });
    try {
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
    } finally {
      for (const turn of turns) turn.resolve();
      await h.close();
    }
  },
);

test(
  'attachments are not recopied and retain historical references until deletion',
  { timeout: 10_000 },
  async () => {
    const h = await harness();
    try {
      const source = join(h.directory, 'notes.txt');
      await writeFile(source, 'saved content');
      const automation = await h.manager.create(message('files', { files: [source] }));
      const saved = automation.files[0];
      assert.ok(saved);
      assert.notEqual(saved, source);
      await writeFile(source, 'changed content');
      assert.equal(await readFile(saved, 'utf8'), 'saved content');
      assert.deepEqual((await h.manager.update(automation.id, { title: 'Renamed' })).files, [
        saved,
      ]);
      await h.manager.runNow(automation.id);
      await h.until((value) => value.runs[0]?.status === 'completed');
      await h.manager.update(automation.id, { files: [] });
      assert.equal(await readFile(saved, 'utf8'), 'saved content');
      await h.manager.remove(automation.id);
      await assert.rejects(readFile(saved), { code: 'ENOENT' });
      assert.equal(await readFile(source, 'utf8'), 'changed content');
    } finally {
      await h.close();
    }
  },
);

test(
  'saved attachments survive source deletion and execute in order after restart',
  { timeout: 10_000 },
  async () => {
    const h = await harness();
    let restarted: AutomationManager | undefined;
    try {
      const sources = [join(h.directory, 'first.txt'), join(h.directory, 'second.txt')];
      await Promise.all(sources.map((path, index) => writeFile(path, `snapshot ${index}`)));
      const automation = await h.manager.create(message('files', { files: sources }));
      await Promise.all(sources.map((path) => rm(path)));
      await h.manager.shutdown();
      const completed = deferred<void>();
      restarted = new AutomationManager({
        dataDir: h.directory,
        launchSession: async () => {
          assert.fail('No replacement chat');
        },
        deliverMessage: async (id, prompt) => {
          assert.equal(id, 'files');
          assert.equal(
            prompt,
            `${automation.prompt}\n\n${automation.files.map((path) => `@${path}`).join('\n')}`,
          );
          assert.deepEqual(
            await Promise.all(automation.files.map((path) => readFile(path, 'utf8'))),
            ['snapshot 0', 'snapshot 1'],
          );
          return { status: 'accepted', settled: Promise.resolve() };
        },
        emit: (event) => {
          if (
            event.type === 'automations.snapshot' &&
            event.snapshot.runs[0]?.status === 'completed'
          ) {
            completed.resolve();
          }
        },
      });
      await restarted.runNow(automation.id);
      await completed.promise;
    } finally {
      await restarted?.shutdown();
      await h.close();
    }
  },
);

test(
  'one-shot targets reject recurrence and unsafe attachments without saving a definition',
  { timeout: 10_000 },
  async () => {
    const h = await harness();
    try {
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
    } finally {
      await h.close();
    }
  },
);

test(
  'queued manual deliveries can be deleted or paused without touching their targets',
  { timeout: 10_000 },
  async () => {
    let attempts = 0;
    const h = await harness({
      deliverMessage: async () => {
        attempts += 1;
        return { status: 'busy', retryOn: 'target' };
      },
    });
    try {
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
    } finally {
      await h.close();
    }
  },
);

test(
  'pausing during setup invalidates the attempt before send and allows deletion',
  { timeout: 10_000 },
  async () => {
    const setup = deferred<void>();
    const entered = deferred<void>();
    const finished = deferred<void>();
    let sent = false;
    const h = await harness({
      deliverMessage: async (_id, _prompt, isCurrent) => {
        entered.resolve();
        await setup.promise;
        sent = isCurrent();
        finished.resolve();
        return { status: 'unavailable', error: 'Canceled before send' };
      },
    });
    try {
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
    } finally {
      setup.resolve();
      await h.close();
    }
  },
);

test(
  'deleting an accepted delivery retains its attachments until the borrowed turn settles',
  { timeout: 10_000 },
  async () => {
    const turn = deferred<void>();
    const h = await harness({
      deliverMessage: async () => ({ status: 'accepted', settled: turn.promise }),
    });
    try {
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
    } finally {
      turn.resolve();
      await h.close();
    }
  },
);

test(
  'attachment-only bridge input survives persistence and reaches the delivery prompt',
  { timeout: 10_000 },
  async () => {
    let delivered = '';
    const h = await harness({
      deliverMessage: async (_id, prompt) => {
        delivered = prompt;
        return { status: 'accepted', settled: Promise.resolve() };
      },
    });
    try {
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
    } finally {
      await h.close();
    }
  },
);
