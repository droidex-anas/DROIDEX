import { parseAutomationStore } from './automationStoreParsing.js';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ClientCommand, SessionSummary } from '../protocol.js';
import { AutomationManager } from './AutomationManager.js';
import type { AutomationInput } from './types.js';

type SessionCreate = Extract<ClientCommand, { type: 'session.create' }>;

type ManagerOptions = ConstructorParameters<typeof AutomationManager>[0];

function createManager(dataDir: string, options: Partial<ManagerOptions> = {}): AutomationManager {
  return new AutomationManager({
    dataDir,
    turnSettleGraceMs: 80,
    emit: () => undefined,
    prepareWorkspace: async ({ cwd }) => cwd ?? '',
    launchSession: async () => undefined,
    ...options,
  });
}

/** A manager over a fresh data directory, recording launches, torn down after the test. */
async function open(
  t: TestContext,
  options: Partial<ManagerOptions> | ((directory: string) => Partial<ManagerOptions>) = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-automations-'));
  const launches: SessionCreate[] = [];
  const manager = createManager(directory, {
    launchSession: async (command) => {
      launches.push(command);
    },
    ...(typeof options === 'function' ? options(directory) : options),
  });
  t.after(async () => {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, worktree: join(directory, 'worktree'), manager, launches };
}

/** Runs the automation now and binds its launch to the chat `appSessionId`. */
async function startRun(
  manager: AutomationManager,
  launches: SessionCreate[],
  automationId: string,
  session: Partial<SessionSummary> & { appSessionId: string },
): Promise<void> {
  await manager.runNow(automationId);
  await waitFor(() => launches.length === 1);
  const launch = launches[0];
  if (!launch) throw new Error('Expected an automation session launch.');
  await manager.observeSessionEvent({
    type: 'session.created',
    clientRef: launch.clientRef,
    session: summary(session),
  });
}

async function streaming(manager: AutomationManager, appSessionId: string, value: boolean) {
  await manager.observeSessionEvent({
    type: 'session.updated',
    session: summary({ appSessionId, streaming: value }),
  });
}

function text(appSessionId: string, id: string, value: string) {
  return {
    type: 'event.appended' as const,
    event: {
      id,
      appSessionId,
      sourceSessionId: appSessionId,
      role: 'primary' as const,
      ts: Date.now(),
      kind: 'text' as const,
      text: value,
    },
  };
}

function task(overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    title: 'Task',
    prompt: 'Do the task.',
    enabled: true,
    schedule: { kind: 'daily', time: '23:59' },
    timezone: 'UTC',
    modelId: 'model-a',
    reasoningEffort: 'high',
    ...overrides,
  };
}

test('a run that resumes during settle grace stays open until the next turn ends', async (context) => {
  const { manager, launches } = await open(context);
  try {
    const automation = await manager.create(task());
    await startRun(manager, launches, automation.id, { appSessionId: 'session-grace' });
    await streaming(manager, 'session-grace', true);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    await streaming(manager, 'session-grace', false);
    assert.equal((await manager.snapshot()).runs[0]?.status, 'running');
    await manager.observeSessionEvent(text('session-grace', 'token-grace', 'still working'));
    context.mock.timers.tick(120);
    assert.equal((await manager.snapshot()).runs[0]?.status, 'running');
    await streaming(manager, 'session-grace', false);
    context.mock.timers.tick(80);
    context.mock.timers.reset();
    await waitFor(async () => (await manager.snapshot()).runs[0]?.status === 'completed');
  } finally {
    context.mock.timers.reset();
  }
});

test('a run still settles when turn events arrive during session adopt', async (t) => {
  const { manager, launches } = await open(t);
  const automation = await manager.create(task());
  await manager.runNow(automation.id);
  await waitFor(() => launches.length === 1);
  const launch = launches[0];
  if (!launch) throw new Error('Expected an automation session launch.');
  assert.equal(launch.autonomy, 'low');
  await Promise.all([
    manager.observeSessionEvent({
      type: 'session.created',
      clientRef: launch.clientRef,
      session: summary({ appSessionId: 'session-race' }),
    }),
    manager.observeSessionEvent(text('session-race', 'token-race', 'working')),
    streaming(manager, 'session-race', false),
  ]);
  await waitFor(async () => (await manager.snapshot()).runs[0]?.status === 'completed');
});

test('closing a chat while it is still streaming fails the run', async (t) => {
  const { manager, launches } = await open(t);
  const automation = await manager.create(task());
  await startRun(manager, launches, automation.id, { appSessionId: 'session-mid-stream' });
  await streaming(manager, 'session-mid-stream', true);
  await manager.observeSessionEvent({ type: 'session.closed', appSessionId: 'session-mid-stream' });
  await waitFor(async () => (await manager.snapshot()).runs[0]?.status === 'failed');
  assert.match((await manager.snapshot()).runs[0]?.error ?? '', /closed before its turn finished/);
});

test('one automation cannot stack a second open run', async (t) => {
  let clock = Date.UTC(2026, 0, 1, 8, 0, 0);
  const dueAt = clock + 60_000;
  const { manager, launches } = await open(t, { now: () => clock, schedulerRecheckMs: 5 });
  const automation = await manager.create(
    task({ schedule: { kind: 'once', runAt: dueAt }, title: 'Once report' }),
  );
  await manager.runNow(automation.id);
  await startRun(manager, launches, automation.id, { appSessionId: 'session-once' });
  await streaming(manager, 'session-once', true);
  clock = dueAt + 1_000;
  await waitFor(async () => {
    const snapshot = await manager.snapshot();
    return snapshot.automations.find((entry) => entry.id === automation.id)?.completedAt === clock;
  });
  assert.equal(launches.length, 1);
  assert.equal((await manager.snapshot()).queuedRunCount, 0);
});

test('an enabled one-time schedule cannot be backdated', async (t) => {
  const { manager } = await open(t);
  await assert.rejects(
    manager.create(task({ schedule: { kind: 'once', runAt: Date.now() - 1_000 } })),
    /future date and time/i,
  );
  assert.equal((await manager.snapshot()).automations.length, 0);
});

test('ordinary chat transcript appends do not persist an automation snapshot', async (t) => {
  const published: string[] = [];
  const { manager } = await open(t, { emit: (event) => published.push(event.type) });
  await manager.snapshot();
  published.length = 0;
  await manager.observeSessionEvent(text('ordinary-chat', 'token-1', 'streaming'));
  assert.deepEqual(published, []);
});

test('a failed adoption write closes the unowned automation chat', async (context) => {
  const closed: string[] = [];
  const { directory, manager, launches } = await open(context, {
    closeSession: async (appSessionId) => {
      closed.push(appSessionId);
    },
  });
  try {
    const automation = await manager.create(task());
    await manager.runNow(automation.id);
    await waitFor(() => launches.length === 1);
    const launch = launches[0];
    if (!launch) throw new Error('Expected an automation session launch.');
    await chmod(directory, 0o555);
    context.mock.method(console, 'error', () => undefined);
    await manager.observeSessionEvent({
      type: 'session.created',
      clientRef: launch.clientRef,
      session: summary({ appSessionId: 'session-orphan' }),
    });
    assert.deepEqual(closed, ['session-orphan']);
    assert.equal((await manager.snapshot()).runs[0]?.status, 'starting');
    assert.equal((await manager.snapshot()).sessionOrigins['session-orphan'], undefined);
  } finally {
    await chmod(directory, 0o755).catch(() => undefined);
  }
});

/** Hands every run the worktree `<directory>/worktree` and records its release. */
function worktreeOptions(released: string[]) {
  return (directory: string): Partial<ManagerOptions> => ({
    prepareWorkspace: async () => join(directory, 'worktree'),
    releaseWorkspace: async ({ resolvedCwd }) => {
      if (resolvedCwd) released.push(resolvedCwd);
    },
  });
}

/** Runs a worktree automation through one turn in the review chat `appSessionId`. */
async function completeWorktreeRun(
  manager: AutomationManager,
  launches: SessionCreate[],
  directory: string,
  appSessionId: string,
) {
  const automation = await manager.create(
    task({ executionMode: 'worktree', workspaceCwd: directory }),
  );
  await startRun(manager, launches, automation.id, { appSessionId });
  await streaming(manager, appSessionId, true);
  await streaming(manager, appSessionId, false);
  return automation;
}

test('a completed run keeps its worktree until the review chat closes', async (t) => {
  const released: string[] = [];
  const { directory, worktree, manager, launches } = await open(t, worktreeOptions(released));
  const automation = await completeWorktreeRun(manager, launches, directory, 'session-review');
  await waitFor(async () => (await manager.snapshot()).runs[0]?.status === 'completed');
  assert.equal(released.length, 0);
  assert.ok((await manager.snapshot()).sessionOrigins['session-review']);
  await assert.rejects(manager.remove(automation.id), /review chat/i);
  await manager.observeSessionEvent({ type: 'session.closed', appSessionId: 'session-review' });
  await waitFor(() => released.includes(worktree));
  assert.deepEqual(released, [worktree]);
  assert.equal((await manager.snapshot()).sessionOrigins['session-review'], undefined);
  await manager.remove(automation.id);
  assert.equal((await manager.snapshot()).automations.length, 0);
});

test('review-chat close releases its worktree when the origin write fails', async (t) => {
  const released: string[] = [];
  const { directory, worktree, manager, launches } = await open(t, (directory) => ({
    ...worktreeOptions(released)(directory),
    turnSettleGraceMs: 20,
  }));
  try {
    await completeWorktreeRun(manager, launches, directory, 'session-review-write-failure');
    const storePath = join(directory, 'automations.json');
    await waitFor(async () => {
      const store = parseAutomationStore(JSON.parse(await readFile(storePath, 'utf8')), Date.now());
      return store.runs[0]?.status === 'completed';
    });

    await chmod(directory, 0o555);
    await assert.rejects(
      manager.observeSessionEvent({
        type: 'session.closed',
        appSessionId: 'session-review-write-failure',
      }),
    );
    assert.deepEqual(released, [worktree]);
  } finally {
    await chmod(directory, 0o755).catch(() => undefined);
  }
});

test('an isolated worktree is not created until its path is persisted', async (t) => {
  const events: string[] = [];
  const { directory, manager } = await open(t, (directory) => ({
    prepareWorkspace: async () => {
      events.push('resolve');
      return join(directory, 'worktree');
    },
    createWorkspace: async () => {
      const store = parseAutomationStore(
        JSON.parse(await readFile(join(directory, 'automations.json'), 'utf8')),
        Date.now(),
      );
      assert.equal(store.runs[0]?.resolvedCwd, join(directory, 'worktree'));
      events.push('create');
    },
    launchSession: async () => {
      events.push('launch');
    },
  }));
  const automation = await manager.create(
    task({ executionMode: 'worktree', workspaceCwd: directory }),
  );
  await manager.runNow(automation.id);
  await waitFor(() => events.includes('launch'));
  assert.deepEqual(events, ['resolve', 'create', 'launch']);
});

test('shutdown releases a worktree materialized before launch', async (t) => {
  const released: string[] = [];
  let finishMaterializing: () => void = () => undefined;
  const materializing = new Promise<void>((resolve) => {
    finishMaterializing = resolve;
  });
  let noteMaterializing: () => void = () => undefined;
  const materializingStarted = new Promise<void>((resolve) => {
    noteMaterializing = resolve;
  });
  const { directory, worktree, manager, launches } = await open(t, (directory) => ({
    ...worktreeOptions(released)(directory),
    createWorkspace: async () => {
      noteMaterializing();
      await materializing;
    },
  }));
  t.after(finishMaterializing);
  const automation = await manager.create(
    task({ executionMode: 'worktree', workspaceCwd: directory }),
  );
  await manager.runNow(automation.id);
  await materializingStarted;
  const shutdown = manager.shutdown();
  finishMaterializing();
  await shutdown;
  assert.deepEqual(launches, []);
  assert.deepEqual(released, [worktree]);
});

/** A second manager over the same directory, as a restarted sidecar opens it. */
function restart(t: TestContext, directory: string, options: Partial<ManagerOptions>) {
  const second = createManager(directory, { prepareWorkspace: async () => '', ...options });
  t.after(() => second.shutdown());
  return second;
}

test('a restarted sidecar can release a worktree created before launch', async (t) => {
  const released: string[] = [];
  const { directory, worktree, manager, launches } = await open(t, worktreeOptions(released));
  const automation = await manager.create(task());
  await manager.runNow(automation.id);
  await waitFor(() => launches.length === 1);
  await manager.shutdown();
  assert.equal(released.length, 0);
  restart(t, directory, worktreeOptions(released)(directory));
  await waitFor(() => released.includes(worktree));
  assert.deepEqual(released, [worktree]);
});

test('a restarted sidecar releases a worktree after its review origin was dropped', async (t) => {
  const released: string[] = [];
  const { directory, worktree, manager, launches } = await open(t, worktreeOptions(released));
  await completeWorktreeRun(manager, launches, directory, 'session-review');
  await waitFor(async () => (await manager.snapshot()).runs[0]?.status === 'completed');
  await manager.shutdown();
  assert.equal(released.length, 0);
  const storePath = join(directory, 'automations.json');
  const store = parseAutomationStore(JSON.parse(await readFile(storePath, 'utf8')), Date.now());
  delete store.sessionOrigins['session-review'];
  await writeFile(storePath, JSON.stringify(store), 'utf8');
  restart(t, directory, worktreeOptions(released)(directory));
  await waitFor(() => released.includes(worktree));
  assert.deepEqual(released, [worktree]);
});

test(
  'a failed store write does not keep scheduler advances in memory',
  { skip: process.platform === 'win32' },
  async (t) => {
    let clock = Date.UTC(2026, 0, 1, 8, 0, 0);
    const dueAt = clock + 60_000;
    const { directory, manager } = await open(t, { now: () => clock });
    try {
      const once = await manager.create(
        task({ schedule: { kind: 'once', runAt: dueAt }, title: 'Once report' }),
      );
      clock = dueAt + 1_000;
      await chmod(directory, 0o555);
      await assert.rejects(manager.create(task({ title: 'Later' })));
      const snapshot = await manager.snapshot();
      await chmod(directory, 0o755);
      assert.equal(snapshot.automations.length, 1);
      assert.equal(snapshot.automations[0]?.id, once.id);
      assert.equal(snapshot.automations[0]?.enabled, true);
      assert.equal(snapshot.automations[0]?.nextRunAt, dueAt);
      assert.equal(snapshot.queuedRunCount, 0);
    } finally {
      await chmod(directory, 0o755).catch(() => undefined);
    }
  },
);

test('overlapping creates both persist', async (t) => {
  const { manager } = await open(t);
  const [left, right] = await Promise.all([
    manager.create(task({ title: 'Left' })),
    manager.create(task({ title: 'Right' })),
  ]);
  const snapshot = await manager.snapshot();
  assert.deepEqual(snapshot.automations.map((automation) => automation.title).sort(), [
    'Left',
    'Right',
  ]);
  assert.notEqual(left.id, right.id);
});

/** A validateSelection whose `nth` call blocks until `release` is called. */
function blockValidation(nth: number) {
  let count = 0;
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let noteStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    noteStarted = resolve;
  });
  const validateSelection = async () => {
    count += 1;
    if (count !== nth) return;
    noteStarted();
    await blocked;
  };
  return { validateSelection, started, release: () => release() };
}

test('overlapping updates merge against the latest stored definition', async (t) => {
  const gate = blockValidation(2);
  t.after(gate.release);
  const { manager } = await open(t, { validateSelection: gate.validateSelection });
  const created = await manager.create(task());
  const titleUpdate = manager.update(created.id, { title: 'Renamed' });
  await gate.started;
  const promptUpdate = manager.update(created.id, { prompt: 'Updated instructions.' });
  gate.release();
  await Promise.all([titleUpdate, promptUpdate]);

  const updated = (await manager.snapshot()).automations[0];
  assert.equal(updated?.title, 'Renamed');
  assert.equal(updated?.prompt, 'Updated instructions.');
});

test('manual queue validation is serialized with deletion', async (t) => {
  const gate = blockValidation(2);
  t.after(gate.release);
  const { manager } = await open(t, { validateSelection: gate.validateSelection });
  const created = await manager.create(task());
  const run = manager.runNow(created.id);
  await gate.started;
  let removed = false;
  const removal = manager.remove(created.id).then(() => {
    removed = true;
  });
  await Promise.resolve();
  assert.equal(removed, false);
  gate.release();
  await Promise.all([run, removal]);
  const snapshot = await manager.snapshot();
  assert.deepEqual(snapshot.automations, []);
  assert.deepEqual(snapshot.runs, []);
});

test('workspace paths keep meaningful leading and trailing spaces', async (t) => {
  const { manager } = await open(t);
  const created = await manager.create(
    task({ enabled: false, workspaceCwd: ' /repo with spaces ', executionMode: 'worktree' }),
  );
  assert.equal(created.workspaceCwd, ' /repo with spaces ');
  assert.equal(created.executionMode, 'worktree');
});

test('shutdown waits for recovered workspace cleanup already in progress', async (t) => {
  const { directory, manager, launches } = await open(t, (directory) => ({
    prepareWorkspace: async () => join(directory, 'worktree'),
  }));
  const automation = await manager.create(task());
  await manager.runNow(automation.id);
  await waitFor(() => launches.length === 1);
  await manager.shutdown();

  let releaseStarted: () => void = () => undefined;
  const cleanupStarted = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  let finishRelease: () => void = () => undefined;
  const releaseBlocked = new Promise<void>((resolve) => {
    finishRelease = resolve;
  });
  const second = createManager(directory, {
    releaseWorkspace: async () => {
      releaseStarted();
      await releaseBlocked;
    },
  });
  let shutdownFinished = false;
  const shutdown = second.shutdown().then(() => {
    shutdownFinished = true;
  });
  await cleanupStarted;
  await Promise.resolve();
  assert.equal(shutdownFinished, false);
  finishRelease();
  await shutdown;
});

test('a chat creates automations directly only at High autonomy, and never from an unattended run', async (t) => {
  const { manager, launches } = await open(t, {
    resolveSessionContext: async (appSessionId) => ({
      cwd: '/repo',
      modelId: 'chat-model',
      reasoningEffort: 'high',
      autonomy: appSessionId === 'low-chat' ? 'low' : 'high',
    }),
  });
  await assert.rejects(
    manager.createFromSession(task({ timezone: 'UTC' }), 'low-chat'),
    /High autonomy/i,
  );
  const automation = await manager.create(task({ autonomy: 'high' }));
  await startRun(manager, launches, automation.id, {
    appSessionId: 'session-run',
    autonomy: 'high',
  });
  await assert.rejects(
    manager.createFromSession(task({ timezone: 'UTC' }), 'session-run'),
    /unattended/i,
  );
  assert.equal((await manager.snapshot()).automations.length, 1);
});

test('concurrent proposal confirmations create one automation from the first input', async (t) => {
  const gate = blockValidation(1);
  t.after(gate.release);
  const { manager } = await open(t, { validateSelection: gate.validateSelection });
  const proposal = await manager.propose(task({ enabled: false }), 'chat');
  const first = manager.confirmProposal(proposal.id, task({ title: 'First', enabled: false }));
  await gate.started;
  const second = manager.confirmProposal(proposal.id, task({ title: 'Second', enabled: false }));
  gate.release();

  const [firstAutomation, secondAutomation] = await Promise.all([first, second]);
  assert.equal(firstAutomation.id, secondAutomation.id);
  assert.equal(firstAutomation.title, 'First');

  const repeated = await manager.confirmProposal(
    proposal.id,
    task({ title: 'Ignored', enabled: false }),
  );
  const snapshot = await manager.snapshot();
  assert.equal(repeated.id, firstAutomation.id);
  assert.deepEqual(
    snapshot.automations.map((automation) => automation.title),
    ['First'],
  );
  assert.equal(snapshot.proposals[0]?.automationId, firstAutomation.id);
});

test('shutdown waits for work started by a run-limit timer', async (context) => {
  let closeStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    closeStarted = resolve;
  });
  let finishClose: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const { manager, launches } = await open(context, {
    closeSession: async () => {
      closeStarted();
      await blocked;
    },
  });
  try {
    const automation = await manager.create(task({ enabled: false }));
    await manager.runNow(automation.id);
    await waitFor(() => launches.length === 1);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    await manager.observeSessionEvent({
      type: 'session.created',
      clientRef: launches[0]?.clientRef,
      session: summary({ appSessionId: 'session-timeout', streaming: true }),
    });

    context.mock.timers.tick(24 * 60 * 60 * 1_000);
    await started;
    let shutdownFinished = false;
    const shutdown = manager.shutdown().then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    assert.equal(shutdownFinished, false);
    finishClose();
    await shutdown;
    assert.equal((await manager.snapshot()).runs[0]?.status, 'failed');
  } finally {
    finishClose();
    context.mock.timers.reset();
  }
});

test('bridge commands answer with an exact result', async (t) => {
  const results: unknown[] = [];
  const { manager } = await open(t, {
    emit: (event) => {
      if (event.type === 'automations.result') results.push(event);
    },
  });
  // An unknown command fails instead of succeeding empty.
  const handled = await manager.handleBridgeCommand({
    type: 'automations.dismissProposal',
    requestId: 'req-unknown',
    id: 'proposal-1',
  });
  assert.equal(handled, true);
  assert.deepEqual(results[0], {
    type: 'automations.result',
    requestId: 'req-unknown',
    ok: false,
    error: 'Unknown automations command: automations.dismissProposal',
  });

  // Run-now names the exact run it queued.
  const automation = await manager.create(task());
  await manager.handleBridgeCommand({
    type: 'automations.runNow',
    requestId: 'req-run-now',
    id: automation.id,
  });
  const queued = (await manager.snapshot()).runs.find(
    (run) => run.automationId === automation.id && run.trigger === 'manual',
  );
  assert.ok(queued);
  assert.deepEqual(results[1], {
    type: 'automations.result',
    requestId: 'req-run-now',
    ok: true,
    runId: queued.id,
  });
});

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1_500,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function summary(overrides: Partial<SessionSummary> & { appSessionId: string }): SessionSummary {
  return {
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Task',
    goal: 'Do the task.',
    cwd: '',
    autonomy: 'low',
    phase: 'running',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
