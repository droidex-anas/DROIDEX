import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { ProjectService, type ProjectPort } from '../projects/ProjectService.js';
import type { ProjectPersistence } from '../projects/store.js';
import type { Project, ThreadInput } from '../projects/types.js';
import type { ServerEvent, SessionSummary } from '../protocol.js';
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

export function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  const launched: ThreadInput[] = [];
  const events: ServerEvent[] = [];
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
    create: async (selection, bind) => {
      const session = summary(`session-${String(++next)}`, selection);
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
      if (session) session.phase = 'paused';
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
    answered,
    asking,
    launched,
    events,
    state,
    port,
    streaming,
    finish,
    ask,
    root,
  };
}
