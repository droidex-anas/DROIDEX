import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { AutomationDeliveryReceipt } from '../automations/types.js';
import { ProjectWakeQueue } from '../projects/ProjectWakeQueue.js';
import { ProjectService } from '../projects/ProjectService.js';
import type { ProjectPort } from '../projects/sessions.js';
import type { ProjectPersistence } from '../projects/store.js';
import type { Project, ThreadInput, ThreadMessage } from '../projects/types.js';
import type {
  PermissionRequest,
  ServerEvent,
  SessionSummary,
  TranscriptEvent,
} from '../protocol.js';
import { sessionSummary } from './sessionSummaryFixture.js';

export const input: ThreadInput = {
  title: 'Build',
  prompt: 'Build the feature.',
  provider: 'droid',
  autonomy: 'low',
  cwd: '/workspace',
};

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function drain() {
  for (let i = 0; i < 8; i += 1) await tick();
}

export function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function waitForThreadStarts(port: ProjectPort, count: number): Promise<void> {
  const admitted = deferred();
  const create = port.create.bind(port);
  let started = 0;
  port.create = (...args) => {
    const work = create(...args);
    started += 1;
    if (started === count) admitted.resolve();
    return work;
  };
  return admitted.promise;
}

export function summary(id: string, selection: ThreadInput = input): SessionSummary {
  const { provider, title, prompt, cwd = '', modelId, reasoningEffort, autonomy } = selection;
  return sessionSummary({
    appSessionId: id,
    provider,
    role: 'user',
    title,
    goal: prompt,
    cwd,
    modelId,
    reasoningEffort,
    autonomy,
    phase: 'running',
    streaming: false,
  });
}

export function interruptedSummary(id: string): SessionSummary {
  return {
    ...summary(id),
    phase: 'paused',
    interruptReason: 'The agent runtime restarted and this turn did not continue.',
  };
}

export const git = (cwd: string, args: string[]) =>
  promisify(execFile)('git', ['-C', cwd, ...args]);

/** A repository with one commit, so a thread can be given a worktree of its own. */
export async function gitRepository(t: TestContext): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'droidex-project-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  await git(tmpdir(), ['init', '-q', repository]);
  await git(repository, [
    ...['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'],
    ...['commit', '-q', '--allow-empty', '-m', 'Start'],
  ]);
  return repository;
}

/** A ProjectService over a faithful fake session port, closed when the test ends. */
export async function harness(t: TestContext, saved: Project[] = [], historyReady = true) {
  const sessions = new Map<string, SessionSummary>();
  const sent: { id: string; prompt: string }[] = [];
  // What reached a running turn, as the lifecycle's steer would take it.
  const steered: { id: string; prompt: string; now: boolean }[] = [];
  const launched: ThreadInput[] = [];
  const events: ServerEvent[] = [];
  const transcripts = new Map<string, TranscriptEvent[]>();
  const state = {
    saved: structuredClone(saved),
    failSave: false,
    gate: undefined as Promise<void> | undefined,
    capacity: 'free' as 'free' | 'busy',
    catalogGate: undefined as Promise<void> | undefined,
    bindGate: undefined as Promise<void> | undefined,
    // Holds a bound thread before its first turn, while it is not streaming yet.
    firstTurnGate: undefined as Promise<void> | undefined,
    createFailure: undefined as 'before-bind' | 'after-bind' | undefined,
    // Sessions waiting on a permission request.
    approvals: new Map<string, PermissionRequest>(),
  };
  const answered: { id: string; requestId: string; answers: unknown[] }[] = [];
  // What each session is actually blocked on, the way the harness would know.
  const asking = new Map<string, string>();
  // A delivered turn settles when its session stops streaming, as the lifecycle's does.
  const turnEnds = new Map<string, () => void>();
  let next = 0;
  let clock = 1;
  const store: ProjectPersistence = {
    load: () => Promise.resolve(structuredClone(state.saved)),
    save: (value) => {
      if (state.failSave) return Promise.reject(new Error('Disk full'));
      state.saved = structuredClone(value);
      return Promise.resolve();
    },
  };
  const port: ProjectPort = {
    get: (id) => sessions.get(id),
    transcriptTail: (id, limit) => Promise.resolve((transcripts.get(id) ?? []).slice(-limit)),
    runtimeLoad: () => ({ live: state.capacity === 'busy' ? 20 : sessions.size, limit: 20 }),
    makeRoom: () => Promise.resolve(state.capacity === 'free'),
    awaitingApproval: (id) => state.approvals.has(id),
    pendingApproval: (id) => state.approvals.get(id),
    approveFor: (_source, target, requestId) => {
      if (state.approvals.get(target)?.requestId !== requestId) return Promise.resolve(false);
      state.approvals.delete(target);
      return Promise.resolve(true);
    },
    isLive: (id) => sessions.has(id),
    catalog: async () => {
      if (state.catalogGate) await state.catalogGate;
      return [
        {
          provider: 'droid' as const,
          readiness: 'ready' as const,
          models: [
            { id: 'droid-core', displayName: 'Droid Core', isCustom: false },
            { id: 'glm-5.3-flash', displayName: 'GLM-5.3-Flash', isCustom: false },
            {
              id: 'custom:glm-5.3-flash',
              displayName: 'GLM-5.3 Flash [Z.AI Chat Completions]',
              isCustom: true,
            },
          ],
        },
      ];
    },
    create: async (selection, bind, _clientRef, appSessionId) => {
      if (state.capacity === 'busy') return null;
      const session = summary(appSessionId ?? `session-${String(++next)}`, selection);
      sessions.set(session.appSessionId, session);
      if (state.bindGate) await state.bindGate;
      if (state.createFailure === 'before-bind') throw new Error('The harness refused to start.');
      await bind(session);
      if (state.createFailure === 'after-bind') throw new Error('The harness exited on start.');
      if (state.firstTurnGate) await state.firstTurnGate;
      launched.push(selection);
      await streaming(session.appSessionId, true);
      return session;
    },
    deliver: async (id, prompt, isCurrent) => {
      // The gate stands for the target's resume and settings, which the real
      // delivery awaits before it checks that its caller still wants it.
      if (state.gate) await state.gate;
      if (!isCurrent()) return { status: 'cancelled' };
      if (state.capacity === 'busy') return { status: 'busy', retryOn: 'capacity' };
      const session = sessions.get(id);
      if (!session || session.streaming) return { status: 'busy', retryOn: 'target' };
      sent.push({ id, prompt });
      const settled = new Promise<void>((resolve) => turnEnds.set(id, resolve));
      await streaming(id, true);
      return { status: 'accepted', settled };
    },
    isAsking: (id, requestId) => asking.get(id) === requestId,
    steer: async (id, prompt, isCurrent, now, delivery) => {
      if (delivery && state.gate) await state.gate;
      if (!sessions.get(id)?.streaming || !isCurrent()) return false;
      delivery?.accepted();
      steered.push({ id, prompt, now });
      delivery?.acknowledged?.();
      // Send now stops the running turn, as the lifecycle's does.
      if (now) await streaming(id, false);
      return true;
    },
    rename: (id, title) => {
      const session = sessions.get(id);
      if (session) sessions.set(id, { ...session, title });
      return Promise.resolve();
    },
    configure: async (id, settings) => {
      const session = sessions.get(id);
      assert.ok(session);
      sessions.set(id, { ...session, ...settings });
      await tick();
    },
    answer: (id, requestId, answers) => {
      answered.push({ id, requestId, answers });
      const live = asking.get(id) === requestId;
      if (live) asking.delete(id);
      return live;
    },
    interrupt: async (id) => {
      const session = sessions.get(id);
      if (!session) return;
      session.phase = 'paused';
      await streaming(id, false);
    },
  };
  const projects = await ProjectService.open(port, store, (event) => events.push(event));
  t.after(() => {
    projects.close();
  });
  if (historyReady) projects.historyReady();
  async function streaming(id: string, value: boolean) {
    const session = sessions.get(id);
    assert.ok(session);
    session.streaming = value;
    // A session's updatedAt moves when its turn settles, as the lifecycle's does.
    if (!value) {
      session.updatedAt = ++clock;
      turnEnds.get(id)?.();
      turnEnds.delete(id);
    }
    await projects.observe({ type: 'session.updated', session: { ...session } });
  }
  async function finish(id: string, text = 'Done') {
    await projects.observe({
      type: 'event.appended',
      event: {
        id: `${id}-text`,
        appSessionId: id,
        sourceSessionId: id,
        role: 'primary',
        ts: 1,
        kind: 'text',
        text,
      },
    });
    await streaming(id, false);
  }
  async function fail(id: string, message: string, usageLimit?: SessionSummary['usageLimit']) {
    const session = sessions.get(id);
    assert.ok(session);
    session.phase = 'failed';
    session.usageLimit = usageLimit;
    await projects.observe({
      type: 'event.appended',
      event: {
        id: `${id}-error`,
        appSessionId: id,
        sourceSessionId: id,
        role: 'primary',
        ts: 1,
        kind: 'error',
        text: message,
        isError: true,
      },
    });
    await streaming(id, false);
  }
  /** The thread `id` asks `question`; `blocked` says whether its harness call is waiting on it. */
  async function ask(
    id: string,
    requestId: string,
    question = 'Which format?',
    options: { label: string }[] = [],
    blocked = true,
  ) {
    if (blocked) asking.set(id, requestId);
    await projects.observe({
      type: 'question.requested',
      question: { appSessionId: id, requestId, questions: [{ index: 0, question, options }] },
    });
  }
  async function root() {
    const { projectId: id, appSessionId: main } = await projects.create(input);
    assert.ok(main);
    await finish(main);
    return { id, main };
  }
  return {
    projects,
    sessions,
    sent,
    steered,
    answered,
    asking,
    launched,
    events,
    transcripts,
    state,
    store,
    port,
    streaming,
    finish,
    fail,
    ask,
    root,
  };
}

/** An ordinary user chat before it adopts a project. */
export async function ordinaryChat(t: TestContext, selection: ThreadInput = input) {
  const h = await harness(t);
  h.sessions.set('ordinary', summary('ordinary', selection));
  return h;
}

/** A settled lead and its first working thread. */
export async function projectWithThread(t: TestContext, selection: ThreadInput = input) {
  const h = await harness(t);
  const { id, main } = await h.root();
  const child = await h.projects.spawn(main, selection);
  return { h, id, main, child };
}

/** A project whose lead has settled, ready to delegate. */
export async function idleProject(t: TestContext) {
  const h = await harness(t);
  const { id, main } = await h.root();
  return { h, id, main };
}

export function wakeMessage(id: string, target = 'main'): ThreadMessage {
  return { id, from: 'worker', to: target, kind: 'result', text: id };
}
export function wakeProject(id = 'project'): Project {
  return {
    id,
    title: id,
    paused: false,
    launching: 0,
    plan: [],
    todos: [],
    threads: [
      { appSessionId: 'main', title: 'Main', reply: '', waiting: false },
      {
        appSessionId: 'worker',
        ownerAppSessionId: 'main',
        title: 'Worker',
        reply: '',
        waiting: false,
      },
    ],
    pending: [wakeMessage('first')],
  };
}

/** A started wake queue over `deliver`, closed and flushed when the test ends. */
export function wakeQueue(
  t: TestContext,
  deliver: (target: string, prompt: string) => Promise<AutomationDeliveryReceipt>,
  options: {
    save?: () => Promise<void>;
    fail?: (error: unknown) => void;
    sessions?: Partial<Pick<ProjectPort, 'get' | 'isLive' | 'steer'>>;
    launch?: (project: Project, thread: Project['threads'][number]) => Promise<boolean>;
  } = {},
): ProjectWakeQueue {
  const queue = new ProjectWakeQueue(
    {
      deliver,
      steer: async (target, prompt, _isCurrent, _now, delivery) => {
        const receipt = await deliver(target, prompt);
        if (receipt.status !== 'accepted') return false;
        delivery?.accepted();
        delivery?.acknowledged?.();
        return true;
      },
      awaitingApproval: () => false,
      pendingApproval: () => undefined,
      get: () => undefined,
      isLive: () => true,
      ...options.sessions,
    },
    options.save ?? (() => Promise.resolve()),
    (_project, error) => {
      if (!options.fail) throw error;
      options.fail(error);
    },
    () => undefined,
    () => () => false,
    options.launch,
  );
  queue.start([]);
  t.after(async () => {
    queue.close();
    await queue.flush();
  });
  return queue;
}

export function queuedThread(appSessionId: string, order: number): Project['threads'][number] {
  return {
    appSessionId,
    ownerAppSessionId: 'main',
    title: appSessionId,
    reply: '',
    waiting: false,
    queuedSpawn: { phase: 'queued', input, order },
  };
}
