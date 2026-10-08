import type { ProjectPort } from './sessions.js';
import { ProjectWakeQueue } from './ProjectWakeQueue.js';
import { wakePrompt } from './projectMessages.js';
import {
  clearAsk,
  removeThread,
  ProjectTurns,
  requireThread,
  resolveThreadId,
  scopedThreads,
  type ThreadState,
} from './projectTurns.js';
import { randomUUID } from 'node:crypto';
import type { ServerEvent, SessionSummary } from '../protocol.js';
import { findPlanStep, planFromSteps, stepNumber } from './plan.js';
import { SpawnedChats, type StartedChat } from './spawnedChats.js';
import { fitLedger, LEDGER_LIMITS, type ProjectPersistence } from './store.js';
import { ProjectReads, acknowledgeReply, type ThreadReadout } from './projectReads.js';
import { ProjectInbox, requireMessageText } from './projectInbox.js';
import { ThreadLaunches } from './threadLaunches.js';
import { ProjectTodos } from './projectTodos.js';
import { ProjectHolds } from './projectHolds.js';
import {
  checkWithinAutonomy,
  discardThreadCheckout,
  type CheckoutClaim,
  LEAD_BRIEF,
  resolveModelId,
  spawnSettings,
  threadCheckout,
  uniqueTitle,
  type ThreadCheckout,
} from './threadStart.js';
import type {
  Project,
  ProjectStep,
  ProjectTodo,
  ProjectView,
  ThreadDelivery,
  ThreadInput,
  ThreadSettings,
  ThreadSpawnInput,
  RuntimeLoad,
} from './types.js';

// Closing a side chat deletes it, so it cannot be the chat a project reports to.
const SIDE_CHAT_CANNOT_LEAD =
  'A side chat cannot lead a project, because closing it deletes it. Start the threads from the chat it branched from.';

const MODEL_CHANGE_PENDING =
  "The new model or effort applies once the thread's current turn ends, or right away if it is idle. Until then modelId and reasoningEffort show what it runs on; thread_read shows the change once it has applied. If it cannot apply, the thread's own chat says why.";

/** A spawn under way and the chat that asked for it, which the user's Stop on that chat cancels. */
interface SpawnUnderWay {
  source: string;
  stopped: boolean;
}

/** What a spawn reports back to the chat that made it. */
interface StartedThread {
  appSessionId: string;
  title: string;
  cwd?: string;
  branch?: string;
  step?: string;
  state: ThreadState;
  delivery: 'started' | 'queued';
  runtimeLoad: RuntimeLoad;
  position?: number;
  waitReason?: string;
  reuseNote?: string;
}

export class ProjectService {
  private readonly projects = new Map<string, Project>();
  private readonly holds: ProjectHolds;
  // Messages to threads still on their way to a running turn, which a finish must wait for.
  private readonly sending = new WeakMap<Project, number>();
  // Sessions last seen mid-turn, so a settle is told from any other update.
  private readonly streamingSessions = new Set<string>();
  private readonly membership = new Map<string, Project>();
  // First spawns share a provisional project until a thread or plan binds.
  // Once all launches settle, empty adoptions are forgotten.
  private readonly adopting = new Map<string, Project>();
  private readonly launches = new Set<Promise<unknown>>();
  /** Starting checkouts transfer their reservation to the queued ledger or live session. */
  private readonly checkoutClaims = new Set<CheckoutClaim>();
  private readonly spawnsUnderWay = new Set<SpawnUnderWay>();
  private readonly wakes: ProjectWakeQueue;
  private readonly turns: ProjectTurns;
  private readonly chats: SpawnedChats;
  private readonly reads: ProjectReads;
  private readonly inbox: ProjectInbox;
  private readonly threadLaunches: ThreadLaunches;
  private readonly todos: ProjectTodos;
  private closed = false;

  private constructor(
    private readonly sessions: ProjectPort,
    private readonly store: ProjectPersistence,
    private readonly emit: (event: ServerEvent) => void,
  ) {
    this.wakes = new ProjectWakeQueue(
      sessions,
      () => this.save(),
      (project, error) => {
        this.fail(project, error);
      },
      (project) => {
        this.inbox.refill(project);
      },
      (project, target) => {
        const restore = this.inbox.refusalRecovery(project, target);
        return (messages) => {
          if (this.closed || this.projects.get(project.id) !== project) return false;
          return restore(
            messages.filter(
              (message) =>
                this.membership.get(message.from) === project &&
                this.membership.get(message.to) === project,
            ),
          );
        };
      },
      async (project, thread) => {
        const queued = thread.queuedSpawn;
        if (!queued) return true;
        const isCurrent = this.wakes.guard(project);
        const load = this.sessions.runtimeLoad();
        if (load.live >= load.limit && !(await this.sessions.makeRoom(thread.appSessionId)))
          return false;
        if (!isCurrent() || thread.queuedSpawn !== queued) return false;
        const claim: CheckoutClaim = { project, cwd: queued.input.cwd };
        this.checkoutClaims.add(claim);
        try {
          return await this.threadLaunches.open(project, thread, isCurrent);
        } finally {
          this.checkoutClaims.delete(claim);
        }
      },
    );
    this.turns = new ProjectTurns({
      project: (appSessionId) => this.membership.get(appSessionId),
      session: (appSessionId) => sessions.get(appSessionId),
      isAsking: (appSessionId, requestId) => sessions.isAsking(appSessionId, requestId),
      enqueue: (project, message) => {
        this.inbox.enqueue(project, message);
      },
      report: (project, thread, text, replyId, leadAlert) => {
        this.inbox.report(project, thread, text, replyId, leadAlert);
      },
      leadFailed: (project) => {
        this.leadFailed(project);
      },
      leadRecovered: (project) => {
        this.leadRecovered(project);
      },
      teamIdle: (project) => {
        this.inbox.teamIdle(project);
      },
      save: () => this.save(),
      fail: (project, error) => {
        this.fail(project, error);
      },
      wakes: this.wakes,
    });
    this.chats = new SpawnedChats(sessions);
    this.reads = new ProjectReads(sessions, this.wakes);
    this.inbox = new ProjectInbox(
      sessions,
      () => this.save(),
      () => !this.closed,
    );
    this.holds = new ProjectHolds(
      sessions,
      this.wakes,
      this.inbox,
      () => this.save(),
      () => !this.closed,
    );
    this.todos = new ProjectTodos(this.projects, this.inbox, this.wakes, () => this.save());
    this.threadLaunches = new ThreadLaunches(
      sessions,
      this.wakes,
      this.membership,
      (project) => this.save(project),
      (source, project) => {
        this.commitAdoption(source, project);
      },
      (project, thread, text, replyId, leadAlert) => {
        this.inbox.report(project, thread, text, replyId, leadAlert);
      },
    );
  }

  static async open(
    sessions: ProjectPort,
    store: ProjectPersistence,
    emit: (event: ServerEvent) => void,
  ): Promise<ProjectService> {
    const owner = new ProjectService(sessions, store, emit);
    const saved = await store.load();
    for (const project of saved) {
      project.launching = 0;
      if (project.delivery) {
        if (
          project.delivery.state === 'sending' &&
          project.delivery.messages.every((message) => message.kind === 'result')
        ) {
          // Unread recovers durable replies; reports without one still need delivery.
          const reports = project.delivery.messages.filter(
            (message) => !message.replyId || !requireThread(project, message.from).reply,
          );
          project.pending.unshift(...reports);
          delete project.delivery;
        } else {
          project.delivery.state = 'uncertain';
          project.paused = true;
          delete project.leadStopped;
          delete project.leadFailed;
        }
      }
      owner.projects.set(project.id, project);
      for (const thread of project.threads) {
        owner.membership.set(thread.appSessionId, project);
        owner.threadLaunches.loaded(thread);
      }
      owner.wakes.kick(project);
    }
    if (saved.length) await owner.save();
    return owner;
  }

  list(): ProjectView[] {
    return [...this.projects.values()].map((project) => this.reads.view(project));
  }

  /** Starts a project and its lead, using the composer's clientRef when supplied. */
  async create(
    input: ThreadInput,
    requestId?: string,
    clientRef?: string,
  ): Promise<{ projectId: string; appSessionId?: string }> {
    this.requireOpen();
    const existing = requestId ? this.projects.get(requestId) : undefined;
    if (existing) {
      // A repeated request waits for its lead before returning the conversation's identity.
      if (existing.launching > 0) await Promise.allSettled([...this.launches]);
      const main = existing.threads.find((thread) => !thread.ownerAppSessionId);
      return { projectId: existing.id, ...(main ? { appSessionId: main.appSessionId } : {}) };
    }
    const project = this.blankProject(input.title, requestId);
    this.projects.set(project.id, project);
    const isCurrent = this.wakes.guard(project);
    let bound: string | undefined;
    project.launching += 1;
    const work = this.save().then(() => {
      if (!isCurrent()) throw new Error('Project launch was cancelled.');
      return this.sessions.create(
        { ...input, prompt: `${LEAD_BRIEF}\n\nTask:\n${input.prompt}` },
        async (session) => {
          if (this.membership.has(session.appSessionId))
            throw new Error('The harness reused an existing thread identity.');
          bound = session.appSessionId;
          await this.threadLaunches.bind(
            project,
            {
              appSessionId: bound,
              title: input.title,
              reply: '',
              waiting: false,
            },
            isCurrent,
          );
        },
        clientRef,
        undefined,
        'user',
      );
    });
    this.launches.add(work);
    try {
      const session = await work;
      if (!session || !bound)
        throw new Error('The selected harness did not start this thread and reported no reason.');
      return { projectId: project.id, appSessionId: bound };
    } catch (error) {
      if (bound) this.membership.delete(bound);
      project.threads = [];
      this.fail(project, error);
      this.projects.delete(project.id);
      throw error;
    } finally {
      this.launches.delete(work);
      project.launching -= 1;
      await this.save();
    }
  }

  async spawn(source: string, requested: ThreadSpawnInput): Promise<StartedThread> {
    this.requireOpen();
    const owner = this.requireSession(source);
    if (owner.sessionPurpose !== 'chat')
      throw new Error('Only ordinary chats can own project threads.');
    if (owner.lineage?.kind === 'side') throw new Error(SIDE_CHAT_CANNOT_LEAD);
    const spawn: SpawnUnderWay = { source, stopped: false };
    this.spawnsUnderWay.add(spawn);
    try {
      const input = await spawnSettings(owner, requested, () => this.sessions.catalog());
      // A chat's first spawn has no project yet for a Stop to hold, so one that
      // came while the settings resolved is only known here.
      if (spawn.stopped) throw new Error('Project launch was cancelled.');
      const joined = this.membership.get(source);
      if (!joined && requested.step)
        throw new Error('This chat keeps no plan yet. Call plan_set first, or spawn without step.');
      if (!joined && requested.workspaceOf)
        throw new Error('This chat has started no threads to share a checkout with.');
      const project = joined ?? this.adoption(source, owner);
      const work = this.startThread(project, spawn, owner, input, requested);
      this.launches.add(work);
      try {
        return await work;
      } finally {
        this.launches.delete(work);
        if (this.settleAdoption(project)) await this.save(project);
      }
    } finally {
      this.spawnsUnderWay.delete(spawn);
    }
  }

  /** A spawn with reportBack false: an ordinary sidebar chat, outside every project. */
  async startChat(source: string, requested: ThreadSpawnInput): Promise<StartedChat> {
    this.requireOpen();
    const project = this.membership.get(source);
    if (project && requireThread(project, source).ownerAppSessionId)
      throw new Error("A thread's spawns always report back to it. Pass reportBack true.");
    const spawn: SpawnUnderWay = { source, stopped: false };
    this.spawnsUnderWay.add(spawn);
    try {
      return await this.chats.start(source, requested, () => spawn.stopped);
    } finally {
      this.spawnsUnderWay.delete(spawn);
    }
  }

  /** Admits, checks out and launches one thread of a project, and links the step it carries. */
  private async startThread(
    project: Project,
    spawn: SpawnUnderWay,
    owner: SessionSummary,
    input: Omit<ThreadInput, 'cwd'>,
    requested: ThreadSpawnInput,
  ): Promise<StartedThread> {
    let ancestor: string | undefined = spawn.source;
    let depth = 0;
    while (ancestor) {
      depth += 1;
      ancestor = requireThread(project, ancestor).ownerAppSessionId;
    }
    if (depth >= 4) throw new Error('Project thread nesting is limited to three levels.');
    // Check admission before cutting a checkout so a refused spawn cannot strand a worktree.
    this.checkAdmission(project);
    if (requested.workspaceOf)
      requested = {
        ...requested,
        workspaceOf: this.resolveThreadId(spawn.source, requested.workspaceOf),
      };
    const named = requested.step ? findPlanStep(project.plan, requested.step) : undefined;
    // Checkout preparation counts as starting until the launch takes ownership.
    project.launching += 1;
    const claim: CheckoutClaim = { project };
    let workspace: ThreadCheckout | undefined;
    try {
      workspace = await threadCheckout(
        claim,
        this.checkoutClaims,
        (id) => this.sessions.get(id),
        owner.cwd,
        requested,
      );
    } finally {
      project.launching -= 1;
    }
    const cwd = workspace?.cwd ?? owner.cwd;
    const title = uniqueTitle(project, input.title);
    let appSessionId: string;
    try {
      this.requireOpen();
      this.checkAdmission(project);
      const guard = this.wakes.guard(project);
      const isCurrent = () => guard() && !spawn.stopped;
      const thread = await this.threadLaunches.enqueue(
        project,
        { ...input, title, ...(cwd ? { cwd } : {}), workspace },
        spawn.source,
        isCurrent,
      );
      if (thread.queuedSpawn?.phase === 'opening')
        await this.threadLaunches.open(project, thread, isCurrent);
      this.wakes.kick(project);
      appSessionId = thread.appSessionId;
    } catch (error) {
      if (workspace) await discardThreadCheckout(owner.cwd, workspace);
      throw error;
    } finally {
      // Checkout ownership has transferred to the queued thread or runtime.
      this.checkoutClaims.delete(claim);
    }
    // Follow the named step if plan_set replaced its object during opening.
    const step =
      named && !project.plan.includes(named)
        ? project.plan.find((candidate) => candidate.title === named.title)
        : named;
    if (step) {
      step.threadAppSessionId = appSessionId;
      await this.save(project);
    }
    const status = this.reads.threadStatus(project, requireThread(project, appSessionId));
    const reuse = scopedThreads(project, spawn.source).find((thread) => {
      if (
        thread.appSessionId === appSessionId ||
        taskTitle(thread.title) !== taskTitle(input.title)
      )
        return false;
      const state = this.reads.threadStatus(project, thread).state;
      return state === 'stopped' || state === 'idle' || state === 'queued';
    });
    const reuseNote = reuse
      ? `${reuse.title} (${reuse.appSessionId}) is ${this.reads.threadStatus(project, reuse).state}; thread_send continues it instead of spawning another.`
      : undefined;
    return {
      appSessionId,
      title,
      state: status.state,
      delivery: status.state === 'queued' ? 'queued' : 'started',
      runtimeLoad: this.sessions.runtimeLoad(),
      ...(status.wait?.kind === 'start' ? { position: status.wait.position } : {}),
      ...(status.waitReason ? { waitReason: status.waitReason } : {}),
      ...(reuseNote ? { reuseNote } : {}),
      ...(workspace ? { cwd: workspace.cwd } : {}),
      ...(workspace && !('joined' in workspace) ? { branch: workspace.branch } : {}),
      ...(step ? { step: step.title } : {}),
    };
  }

  /**
   * Replaces the plan a chat keeps for its project, in its own words. A chat
   * that leads no project yet becomes one with its first plan, so it can plan
   * first and then spawn a thread for each step.
   */
  async setPlan(
    source: string,
    steps: readonly (Omit<ProjectStep, 'id'> & { id?: string })[],
    title?: string,
    brief?: string,
  ): Promise<number> {
    this.requireOpen();
    if (brief !== undefined && brief.length > LEDGER_LIMITS.brief)
      throw new Error('Project brief must be at most 2000 characters.');
    if (steps.length > LEDGER_LIMITS.planSteps)
      throw new Error(`A project plan holds at most ${String(LEDGER_LIMITS.planSteps)} steps.`);
    let project = this.membership.get(source);
    if (project && requireThread(project, source).ownerAppSessionId)
      throw new Error('Only the chat that leads a project keeps its plan.');
    // Named before anything changes: a name the chat refuses leaves no project
    // half made and no plan replaced; Droid keeps the title itself and can refuse it.
    const name = title?.slice(0, LEDGER_LIMITS.title);
    if (name && name !== project?.title && (project || steps.length)) {
      await this.sessions.rename(source, name);
      // Another plan for this chat may have made its project meanwhile.
      project = this.membership.get(source);
    }
    if (!project) {
      // With no project there is no plan to clear.
      if (!steps.length) return 0;
      const owner = this.requireSession(source);
      if (owner.sessionPurpose !== 'chat')
        throw new Error('Only ordinary chats can keep a project plan.');
      if (owner.lineage?.kind === 'side') throw new Error(SIDE_CHAT_CANNOT_LEAD);
      if (steps.some((step) => step.threadAppSessionId))
        throw new Error('This chat has started no threads yet; leave threadId out.');
      project = this.adoption(source, owner);
      this.commitAdoption(source, project);
    }
    if (name) {
      project.title = name;
      requireThread(project, source).title = name;
    }
    const resolved = steps.map((step) => ({
      ...step,
      ...(step.threadAppSessionId
        ? { threadAppSessionId: this.resolveThreadId(source, step.threadAppSessionId) }
        : {}),
    }));
    const members = new Set(project.threads.map((thread) => thread.appSessionId));
    project.plan = planFromSteps(
      resolved,
      (id) => members.has(id),
      project.plan,
      project.lastStepId,
    );
    project.lastStepId = Math.max(
      project.lastStepId ?? 0,
      // Only whole-number ids advance the counter; a lead may name steps "1.1".
      ...project.plan.map((step) => stepNumber(step.id)),
    );
    if (brief !== undefined) project.brief = brief;
    if (project.plan.some((step) => step.state !== 'done')) delete project.done;
    this.settleAdoption(project);
    await this.save();
    return project.plan.length;
  }

  /** The lead's word that the goal is achieved. Spawning again reopens the project. */
  async finish(source: string, outcome: string): Promise<void> {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    if (requireThread(project, source).ownerAppSessionId)
      throw new Error('Only the chat that leads a project can mark it done.');
    const outstanding: string[] = [];
    if (project.launching > 0) outstanding.push('Threads are still starting.');
    for (const thread of project.threads) {
      if (thread.appSessionId === source) continue;
      const state = this.reads.threadStatus(project, thread).state;
      if (thread.unread) outstanding.push(`${thread.title}: unread report.`);
      if (thread.owedReport) outstanding.push(`${thread.title}: report awaiting delivery.`);
      if (thread.queuedSpawn) outstanding.push(`${thread.title}: queued to start.`);
      if (thread.ask) outstanding.push(`${thread.title}: waiting on an answer.`);
      if (state === 'approval') outstanding.push(`${thread.title}: waiting on an approval.`);
      if (state === 'failed' || state === 'rate-limited')
        outstanding.push(`${thread.title}: ${state}. Continue it with thread_send.`);
      if (this.sessions.get(thread.appSessionId)?.streaming)
        outstanding.push(`${thread.title}: still working.`);
    }
    for (const todo of project.todos) outstanding.push(`Open to-do: ${todo.text}`);
    const messages = [...project.pending, ...(project.delivery?.messages ?? [])];
    const toLead = messages.filter((message) => message.to === source);
    const toThreads = messages.length - toLead.length;
    if (toLead.length) outstanding.push(`${String(toLead.length)} pending messages to the lead.`);
    if (toThreads || (this.sending.get(project) ?? 0) > 0)
      outstanding.push('Messages to threads are still on their way.');
    if (outstanding.length)
      throw new Error(
        `Project has outstanding work:\n${outstanding.map((item) => `- ${item}`).join('\n')}`,
      );
    project.done = { at: Date.now(), outcome: outcome.slice(0, LEDGER_LIMITS.outcome) };
    await this.save();
  }

  publish(): void {
    // Loading Projects reads summaries, never resumes dormant providers.
    for (const project of this.projects.values()) {
      for (const thread of project.threads) {
        const session = this.sessions.get(thread.appSessionId);
        if (session) this.emit({ type: 'session.updated', session });
      }
    }
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }

  /** Answers only the current question, without reopening a completed project. */
  async answer(source: string, target: string, questionId: string, answers: string[]) {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const thread = requireThread(project, target);
    const ask = thread.ask;
    if (!ask) throw new Error(`${thread.title} has no question waiting for an answer.`);
    if (!questionId) throw new Error('Pass the questionId of the question these answers are for.');
    if (questionId !== ask.requestId)
      throw new Error(
        `${thread.title} is no longer waiting on that question. Read it again with thread_read.`,
      );
    if (answers.length !== ask.questions.length)
      throw new Error(
        `${thread.title} asked ${String(ask.questions.length)} questions; answer them all, in order.`,
      );
    const landed = this.sessions.answer(
      target,
      questionId,
      ask.questions.map((item, index) => ({
        index: item.index,
        question: item.question,
        answer: answers[index],
      })),
    );
    clearAsk(project, thread);
    await this.save();
    this.wakes.kick(project);
    return {
      threadId: target,
      answered: landed,
      state: this.reads.threadStatus(project, thread).state,
    };
  }

  /** Sends instructions through the same queue that owns report delivery. */
  async send(
    source: string,
    target: string,
    text: string,
    delivery: ThreadDelivery = 'steer',
  ): Promise<'steered' | 'interrupt' | 'started' | 'resumed' | 'queued' | 'held'> {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const thread = requireThread(project, target);
    if (thread.ask)
      throw new Error(
        `${thread.title} is waiting on the question it asked. Answer it with thread_answer.`,
      );
    // A running turn takes it at the harness's next step, or, sent now, in
    // place of the rest of that turn. A thread with no turn running gets it as
    // its next turn, which the wake queue starts.
    requireMessageText(text);
    // Work sent to a thread means the goal is open again; cleared before any
    // wait, so a project_done racing this send sees the work.
    const reopened = project.done !== undefined;
    delete project.done;
    // A held project holds its main chat's messages too: they queue for Resume.
    if (delivery !== 'queue' && !project.paused && this.sessions.get(target)?.streaming) {
      const message = {
        id: randomUUID(),
        from: source,
        to: target,
        kind: 'message' as const,
        text,
      };
      const prompt = wakePrompt(project, target, [message]);
      // Only this thread leaving the project withdraws it. A Stop on the
      // thread drops it with the rest of that chat's queue, as it would the user's.
      const holds = this.holds.generation(project);
      const isCurrent = () =>
        !this.closed &&
        !project.paused &&
        this.holds.generation(project) === holds &&
        this.membership.get(target) === project;
      this.sending.set(project, (this.sending.get(project) ?? 0) + 1);
      let steered: boolean;
      try {
        steered = await this.sessions.steer(target, prompt, isCurrent, delivery === 'interrupt');
      } finally {
        this.sending.set(project, (this.sending.get(project) ?? 1) - 1);
      }
      if (steered) {
        const recovered = this.inbox.forgetRecovery(target, project);
        if (reopened || recovered) await this.save();
        return delivery === 'interrupt' ? 'interrupt' : 'steered';
      }
      // Its turn ended, or was stopped, while this was on its way. Starting a
      // new turn could undo a Stop, so the lead decides.
      throw new Error(
        `${thread.title}'s turn ended before it took this message. Read it with thread_read, and send again if the message still applies.`,
      );
    }
    const resumed = !this.sessions.isLive(target) || this.sessions.get(target)?.phase === 'paused';
    const message = this.inbox.enqueue(project, {
      from: source,
      to: target,
      kind: 'message',
      text,
    });
    await this.save();
    this.wakes.kick(project);
    if (project.paused) return 'held';
    const accepted = await this.wakes.dispatch(project, message);
    const currentProject = this.controlledProject(source, target);
    if (currentProject !== project || requireThread(project, target) !== thread)
      throw new Error('Thread changed while sending. Read it before sending again.');
    if (accepted) return resumed ? 'resumed' : 'started';
    if (currentProject.paused) return 'held';
    const pending = [...project.pending, ...(project.delivery?.messages ?? [])];
    if (pending.some((item) => item.id === message.id)) return 'queued';
    throw new Error(
      'The message was cancelled before it started. Read the thread before sending again.',
    );
  }

  read(source: string, target: string, replies = 1): ThreadReadout {
    target = this.resolveThreadId(source, target);
    return this.reads.read(this.controlledProject(source, target), target, replies);
  }

  async readFull(source: string, target: string): Promise<ThreadReadout> {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    return this.reads.readFull(
      project,
      target,
      () => !this.closed && this.membership.get(target) === project,
    );
  }

  async markRead(source: string, target: string, replyId: string | undefined): Promise<void> {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const cleared = await acknowledgeReply(
      requireThread(project, target),
      replyId,
      () => this.save(),
      () => !this.closed && this.membership.get(target) === project,
    );
    if (cleared) this.emit({ type: 'projects.snapshot', projects: this.list() });
  }

  listThreads(source: string, all = false) {
    this.requireOpen();
    return this.reads.listThreads(this.requireProjectFor(source), source, all);
  }

  projectRead(source: string) {
    return this.reads.projectRead(this.requireLeadProject(source), source);
  }

  resolveThreadId(source: string, target: string): string {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    const id = resolveThreadId(project, source, target);
    this.controlledProject(source, id);
    return id;
  }

  async addTodo(
    source: string,
    input: { text: string; after?: string; inMinutes?: number; at?: string },
  ): Promise<Omit<ProjectTodo, 'notified'>> {
    const project = this.requireLeadProject(source);
    const after = input.after ? this.resolveThreadId(source, input.after) : undefined;
    return this.todos.add(project, { ...input, after });
  }

  async doneTodo(source: string, id: string): Promise<void> {
    const project = this.requireLeadProject(source);
    await this.todos.done(project, id);
  }

  private requireLeadProject(source: string): Project {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    if (requireThread(project, source).ownerAppSessionId)
      throw new Error('Only the chat that leads a project keeps its to-dos.');
    return project;
  }

  /**
   * Retunes a thread within the limits of the chat that started it, and reads
   * back what took. Autonomy applies before this returns. A new model or effort
   * is handed over instead: a Claude thread takes one only once its running
   * turn ends, and that turn may be waiting on this caller.
   */
  async configure(
    source: string,
    target: string,
    settings: ThreadSettings,
  ): Promise<ThreadReadout & { pending?: string }> {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const caller = this.requireSession(source);
    const thread = requireThread(project, target);
    const queued = thread.queuedSpawn;
    if (queued?.phase === 'opening')
      throw new Error('The thread is opening. Configure it once it has started.');
    const selection = queued?.input ?? this.requireSession(target);
    const modelId = settings.modelId
      ? resolveModelId(await this.sessions.catalog(), caller, selection.provider, settings.modelId)
      : undefined;
    // A lead can retune a thread its own thread started, and that thread is the
    // ceiling, not the lead.
    const owner = thread.ownerAppSessionId ?? source;
    if (settings.autonomy) checkWithinAutonomy(this.requireSession(owner), settings.autonomy);
    const model = {
      ...(modelId ? { modelId } : {}),
      ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
    };
    if (queued) {
      this.requireOpen();
      if (thread.queuedSpawn?.phase === 'opening')
        throw new Error('The thread is opening. Configure it once it has started.');
      if (thread.queuedSpawn !== queued)
        throw new Error('The queued thread changed while configuring it. Try again.');
      Object.assign(queued.input, model);
      if (settings.autonomy) queued.input.autonomy = settings.autonomy;
      await this.save();
      return this.read(source, target);
    }
    const modelChanged = Object.keys(model).length > 0;
    // Handed over before the autonomy change is awaited, so it applies from the
    // thread's next turn. The thread's own chat reports a change that fails, as
    // it does for the composer's controls.
    if (modelChanged)
      void this.sessions.configure(target, model).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.emit({
          type: 'error',
          code: 'session.model_update_failed',
          appSessionId: target,
          message: `Could not change the chat's settings: ${reason}`,
          recoverable: true,
        });
      });
    if (settings.autonomy) await this.sessions.configure(target, { autonomy: settings.autonomy });
    this.wakes.kick(project);
    return {
      ...this.read(source, target),
      ...(modelChanged ? { pending: MODEL_CHANGE_PENDING } : {}),
    };
  }

  async stop(source: string, target: string): Promise<'stopped' | 'cancelled'> {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const turnCount = this.turns.turnCount(target);
    this.wakes.invalidateTarget(target);
    await this.sessions.interrupt(target);
    return this.quiet(project, target, turnCount);
  }

  async setPaused(id: string, paused: boolean, acknowledgeDelivery = false): Promise<void> {
    this.requireOpen();
    const project = this.projects.get(id);
    if (!project) throw new Error('Project not found.');
    if (paused) await this.holds.pause(project);
    else await this.holds.resume(project, acknowledgeDelivery);
  }

  async pause(source: string): Promise<{ interrupted: string[] }> {
    const project = this.requireLeadProject(source);
    return { interrupted: await this.holds.pause(project, source) };
  }

  async resume(source: string): Promise<{ resumed: string[] }> {
    const project = this.requireLeadProject(source);
    return { resumed: await this.holds.resume(project) };
  }

  async approve(
    source: string,
    threadId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ): Promise<{ state: string }> {
    threadId = this.resolveThreadId(source, threadId);
    const project = this.controlledProject(source, threadId);
    if (project.paused)
      throw new Error('The project is held. Resume it before deciding approvals.');
    const thread = requireThread(project, threadId);
    if (note?.trim()) requireMessageText(note);
    const isCurrent = this.wakes.guard(project, threadId);
    const sourceCurrent = this.wakes.targetGuard(source);
    if (this.sessions.pendingApproval(threadId, requestId)?.requestId !== requestId)
      throw new Error(
        `${thread.title} is no longer waiting on that approval. Read it again with thread_read.`,
      );
    if (!(await this.sessions.approveFor(source, threadId, requestId, decision)))
      throw new Error('The approval settled before your decision. Read the thread again.');
    if (!isCurrent() || !sourceCurrent() || this.membership.get(threadId) !== project)
      return { state: 'stopped' };
    project.pending = project.pending.filter(
      (message) => message.approvalId !== requestId || message.from !== threadId,
    );
    if (note?.trim())
      this.inbox.enqueue(project, { from: source, to: threadId, kind: 'message', text: note });
    await this.save();
    this.wakes.available(project, threadId);
    return { state: this.reads.threadStatus(project, thread).state };
  }

  /**
   * A user Stop quiets that conversation; workers continue while lead reports wait.
   */
  async userStopped(appSessionId: string): Promise<void> {
    for (const spawn of this.spawnsUnderWay)
      if (spawn.source === appSessionId) spawn.stopped = true;
    // A chat's first project is still being adopted until its thread binds,
    // and a Stop then has to cancel that spawn like any other.
    const project = this.membership.get(appSessionId) ?? this.adopting.get(appSessionId);
    if (!project || this.closed) return;
    const turnCount = this.turns.turnCount(appSessionId);
    if (!requireThread(project, appSessionId).ownerAppSessionId) {
      project.leadStopped = true;
      delete project.leadFailed;
      this.wakes.invalidateTarget(appSessionId);
      await this.save();
      return;
    }
    this.wakes.invalidateTarget(appSessionId);
    await this.quiet(project, appSessionId, turnCount);
  }

  async userContinued(appSessionId: string): Promise<void> {
    const project = this.membership.get(appSessionId);
    if (
      this.closed ||
      !project ||
      !(project.leadStopped ?? project.leadFailed) ||
      requireThread(project, appSessionId).ownerAppSessionId
    )
      return;
    if (project.leadFailed && !project.paused) delete project.error;
    delete project.leadStopped;
    delete project.leadFailed;
    await this.save();
    this.wakes.available(project, appSessionId);
  }

  async observe(event: ServerEvent): Promise<void> {
    if (this.closed) return;
    if (event.type === 'session.closed' && this.membership.has(event.appSessionId))
      this.wakes.invalidateTarget(event.appSessionId);
    // Read before any wait, so a slow save cannot reorder a turn's start and end.
    const settled = event.type === 'session.updated' && this.noteStreaming(event.session);
    // Decided as the event arrives, so a project_done made while this observer
    // waits is never undone by it; saved once the turn is recorded.
    const reopened =
      event.type === 'session.updated' &&
      event.session.streaming &&
      this.reopenOnWork(event.session.appSessionId);
    const recovered =
      event.type === 'session.updated' &&
      event.session.streaming &&
      this.inbox.forgetRecovery(
        event.session.appSessionId,
        this.membership.get(event.session.appSessionId),
      );
    await this.turns.observe(event);
    if (reopened || recovered) await this.save();
    // A delivered turn that stops on the user's approval frees its slot.
    if (event.type === 'approval.requested') {
      const project = this.membership.get(event.request.appSessionId);
      if (project) {
        this.inbox.refillApprovals(project);
        await this.save();
        this.wakes.kick(project);
      }
      this.wakes.waitingChanged();
      return;
    }
    if (event.type === 'interaction.cancelled') {
      const project = this.membership.get(event.appSessionId);
      if (project) {
        project.pending = project.pending.filter(
          (message) =>
            message.from !== event.appSessionId || message.approvalId !== event.requestId,
        );
        await this.save();
      }
      return;
    }
    // A session whose turn just settled may be one the runtime cap can release
    // now, which is what a delivery parked on capacity is waiting for. Other
    // updates free nothing, and retrying on each would only churn.
    if (settled) this.wakes.sessionIdle(this.projects.values());
    if (event.type !== 'session.closed') return;
    // A delivery parked on a busy member waits for its turn to settle. A closed
    // session never settles one, and the next delivery resumes it instead.
    const project = this.membership.get(event.appSessionId);
    if (project) this.wakes.available(project, event.appSessionId);
    // A released runtime hands back a scheduled slot, which is exactly what a
    // delivery parked on capacity is waiting for. Nothing else announces it:
    // the capacity hook fires for a resume that produced no runtime, not for a
    // session that closed.
    this.capacityChanged();
  }

  /** A thread working again means its finished project's goal is open after all. */
  private reopenOnWork(appSessionId: string): boolean {
    const project = this.membership.get(appSessionId);
    if (!project?.done || !requireThread(project, appSessionId).ownerAppSessionId) return false;
    delete project.done;
    return true;
  }

  /** True when this update ends a turn the session was last seen running. */
  private noteStreaming(session: SessionSummary): boolean {
    if (session.streaming) {
      this.streamingSessions.add(session.appSessionId);
      return false;
    }
    return this.streamingSessions.delete(session.appSessionId);
  }

  /** Session history knows every thread now, so what a restart left queued can go out. */
  historyReady(): void {
    void this.inbox.recover(this.projects.values()).then(
      () => {
        if (this.closed) return;
        this.wakes.start(this.projects.values());
        this.todos.start();
      },
      (error: unknown) => {
        for (const project of this.projects.values()) this.fail(project, error);
      },
    );
  }

  sessionAvailable(appSessionId: string): void {
    const project = this.membership.get(appSessionId);
    if (project) this.wakes.available(project, appSessionId);
  }

  capacityChanged(): void {
    this.wakes.capacityChanged(this.projects.values());
  }

  close(): void {
    this.closed = true;
    this.todos.close();
    this.inbox.close();
    this.wakes.close();
    this.turns.clear();
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.launches);
    await this.wakes.flush();
    await this.save();
  }

  /** A failed lead stops coordination while workers finish their own work. */
  private leadFailed(project: Project): void {
    project.leadFailed = true;
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (lead) this.wakes.invalidateTarget(lead.appSessionId);
    if (!project.paused)
      project.error =
        'The lead failed. Workers continue; reports wait until you send the lead a message or resume the project.';
  }

  /** A successful lead turn restores coordination without releasing another hold. */
  private leadRecovered(project: Project): void {
    if (!project.leadFailed || project.delivery) return;
    delete project.leadFailed;
    if (!project.paused) delete project.error;
    this.wakes.kick(project);
  }

  /** Drops what was queued for a stopped thread once admission has settled. */
  private async quiet(
    project: Project,
    target: string,
    turnCount: number,
  ): Promise<'stopped' | 'cancelled'> {
    await this.wakes.settle(project);
    const thread = requireThread(project, target);
    // A turn that opened while Stop settled is newer work: its question and its
    // restart continuation stay. Opening it already cleared the stopped turn's question.
    const sameTurn = this.turns.turnCount(target) === turnCount;
    if (sameTurn) clearAsk(project, thread);
    if (project.interrupted) {
      project.interrupted = project.interrupted.filter((id) => id !== target);
      if (!project.interrupted.length) delete project.interrupted;
    }
    if (sameTurn) thread.stopped = true;
    this.inbox.forgetRecovery(target, project);
    const queued = thread.queuedSpawn;
    const checkoutOwner = queued?.workspace
      ? this.requireSession(thread.ownerAppSessionId ?? '')
      : undefined;
    if (queued) {
      delete thread.queuedSpawn;
      removeThread(project, thread);
      this.membership.delete(target);
      for (const step of project.plan)
        if (step.threadAppSessionId === target) delete step.threadAppSessionId;
      for (const todo of project.todos) if (todo.after === target) delete todo.after;
    }
    this.inbox.withdraw(project, thread);
    await this.save();
    if (queued?.workspace && checkoutOwner)
      await discardThreadCheckout(checkoutOwner.cwd, queued.workspace);
    this.wakes.kick(project);
    return queued ? 'cancelled' : 'stopped';
  }

  private blankProject(title: string, id: string = randomUUID()): Project {
    return {
      id,
      title: title.slice(0, LEDGER_LIMITS.title) || 'Project',
      startedAt: Date.now(),
      paused: false,
      launching: 0,
      plan: [],
      todos: [],
      threads: [],
      pending: [],
    };
  }

  /** The project a chat builds with its first spawn or plan, shared by first spawns made in parallel. */
  private adoption(source: string, owner: SessionSummary): Project {
    const pending = this.adopting.get(source);
    if (pending) return pending;
    const project = this.blankProject(owner.title);
    project.threads.push({
      appSessionId: source,
      title: owner.title.slice(0, LEDGER_LIMITS.title) || 'Main conversation',
      reply: '',
      waiting: false,
    });
    this.adopting.set(source, project);
    return project;
  }

  /** Puts an adoption in the ledger, as its first thread binds or it writes a plan. */
  private commitAdoption(source: string, project: Project): void {
    if (this.adopting.get(source) !== project || this.projects.has(project.id)) return;
    this.projects.set(project.id, project);
    this.membership.set(source, project);
  }

  // Forget an empty adoption only after all its launches settle.
  // True means the ledger changed and the caller must save it.
  private settleAdoption(project: Project): boolean {
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (!lead || project.launching > 0 || this.adopting.get(lead.appSessionId) !== project)
      return false;
    this.adopting.delete(lead.appSessionId);
    if (
      project.threads.length > 1 ||
      project.plan.length ||
      project.todos.length ||
      !this.projects.has(project.id)
    )
      return false;
    this.projects.delete(project.id);
    this.membership.delete(lead.appSessionId);
    return true;
  }

  private controlledProject(source: string, target: string): Project {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    const actor = requireThread(project, source);
    const thread = requireThread(project, target);
    if (source === target || (actor.ownerAppSessionId && thread.ownerAppSessionId !== source))
      throw new Error('Only the main thread or a direct owner can control this thread.');
    return project;
  }

  private requireProjectFor(source: string): Project {
    const project = this.membership.get(source);
    if (!project) throw new Error('This chat has not spawned a project thread.');
    return project;
  }

  private requireSession(appSessionId: string): SessionSummary {
    const session = this.sessions.get(appSessionId);
    if (!session) throw new Error('Session is no longer available.');
    return session;
  }

  /* A project takes as many threads as its work needs. What keeps one from
     running away is the nesting limit, the approval a spawn needs below High,
     and the hold on threads talking in circles, not a count. */
  private checkAdmission(project: Project): void {
    if (!project.paused) return;
    // A provisional project has no Resume control yet.
    if (!this.projects.has(project.id)) throw new Error('Project launch was cancelled.');
    throw new Error('This project is held. Ask the user to resume it in Projects first.');
  }

  private requireOpen(): void {
    if (this.closed) throw new Error('Projects are shutting down.');
  }

  private fail(project: Project, error: unknown): void {
    this.wakes.invalidate(project);
    this.holds.note(project);
    project.paused = true;
    delete project.leadStopped;
    delete project.leadFailed;
    const message = error instanceof Error ? error.message : String(error);
    project.error = message.slice(0, LEDGER_LIMITS.projectError);
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }

  private async save(
    affectedProject?: Project,
    projects = [...this.projects.values()],
  ): Promise<void> {
    fitLedger(projects, (appSessionId) => this.sessions.get(appSessionId)?.updatedAt ?? 0);
    try {
      await this.store.save(projects);
    } catch (error) {
      if (affectedProject) this.fail(affectedProject, error);
      else for (const project of this.projects.values()) this.fail(project, error);
      throw error;
    }
    this.todos.arm();
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }
}

function taskTitle(title: string): string {
  return title
    .replace(/(?:\s+\d+|\s*\(retry\))$/i, '')
    .trim()
    .toLowerCase();
}
