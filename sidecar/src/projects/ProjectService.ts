import type { AutomationDeliveryReceipt } from '../automations/types.js';
import type { SteeredReportDelivery } from '../SessionLifecycle.js';
import { TURN_INTERRUPTED } from '../sessionAdoption.js';
import { ProjectWakeQueue } from './ProjectWakeQueue.js';
import { failureReport, unreadThreadNote, wakePrompt } from './projectMessages.js';
import {
  clearAsk,
  ProjectTurns,
  requireThread,
  resolveThreadId,
  scopedThreads,
  threadState,
  threadWaitReason,
  type ThreadState,
} from './projectTurns.js';
import { randomUUID } from 'node:crypto';
import type {
  PermissionRequest,
  ProviderStatus,
  ServerEvent,
  SessionSummary,
  TranscriptEvent,
} from '../protocol.js';
import { latestSettledReply } from './activity.js';
import { findPlanStep, planFromSteps } from './plan.js';
import { SpawnedChats, type StartedChat } from './spawnedChats.js';
import { fitLedger, LEDGER_LIMITS, type ProjectPersistence } from './store.js';
import {
  checkWithinAutonomy,
  discardThreadCheckout,
  type CheckoutClaim,
  LEAD_BRIEF,
  THREAD_BRIEF,
  resolveModelId,
  spawnSettings,
  threadCheckout,
  threadPrompt,
  uniqueTitle,
  type ThreadCheckout,
} from './threadStart.js';
import type {
  Project,
  ProjectStep,
  ProjectThread,
  ProjectTodo,
  ProjectView,
  ThreadDelivery,
  ThreadInput,
  ThreadMessage,
  ThreadSettings,
  ThreadSpawnInput,
  RuntimeLoad,
  ThreadWait,
} from './types.js';

export interface ProjectPort {
  transcriptTail(appSessionId: string, limit: number): Promise<TranscriptEvent[]>;
  runtimeLoad(): RuntimeLoad;
  makeRoom(appSessionId: string): Promise<boolean>;
  get(appSessionId: string): SessionSummary | undefined;
  /** What each provider can run right now, so a spawn cannot name a model that is not there. */
  catalog(): Promise<ProviderStatus[]>;
  /** Null means capacity refused the start; undefined means the open was withdrawn. */
  create(
    input: ThreadInput,
    bind: (session: SessionSummary) => Promise<void>,
    clientRef?: string,
    appSessionId?: string,
    start?: 'user' | 'automatic',
  ): Promise<SessionSummary | null | undefined>;
  deliver(
    appSessionId: string,
    prompt: string,
    isCurrent: () => boolean,
  ): Promise<AutomationDeliveryReceipt>;
  interrupt(appSessionId: string): Promise<void>;
  /** Whether a question routed to an owner is still waiting on its thread. */
  isAsking(appSessionId: string, requestId: string): boolean;
  /** Whether the conversation is waiting on a permission request. */
  awaitingApproval(appSessionId: string): boolean;
  pendingApproval(appSessionId: string, requestId?: string): PermissionRequest | undefined;
  approveFor(
    source: string,
    target: string,
    requestId: string,
    decision: 'allow' | 'deny',
  ): Promise<boolean>;
  /** Whether its runtime is open; an idle one is released to save memory. */
  isLive(appSessionId: string): boolean;
  /** Retunes a live thread, the way the composer's own controls do. */
  configure(appSessionId: string, settings: ThreadSettings): Promise<void>;
  /** Hands a prompt to the turn a chat is running, as the user's Steer does, or,
      when `now`, stops that turn so the prompt runs next. False when no turn took it. */
  steer(
    appSessionId: string,
    prompt: string,
    isCurrent: () => boolean,
    now: boolean,
    delivery?: SteeredReportDelivery,
  ): Promise<boolean>;
  rename(appSessionId: string, title: string): Promise<void>;
  /** Answers a question a thread is blocked on; false when it was already settled. */
  answer(
    appSessionId: string,
    requestId: string,
    answers: { index: number; question: string; answer: string }[],
  ): boolean;
}

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

interface ThreadLaunchInput extends ThreadInput {
  workspace?: ThreadCheckout;
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

/** What a chat reads back about a thread it owns. */
export interface ThreadReadout {
  threadId: string;
  title: string;
  state: ThreadState;
  approval?: { requestId: string; summary: string };
  resetsAt?: number;
  waitReason?: string;
  runtimeLoad: RuntimeLoad;
  wait?: ThreadWait;
  position?: number;
  /** The replies asked for, oldest first; the latest one alone by default. */
  replies: string[];
  /** Older replies DROIDEX still holds, for an owner that wants more context. */
  moreReplies: number;
  /** Messages to it not yet seen taken: queued, handed over, or steered and unread. */
  queued: number;
  /** False when no runtime is open for it: released while idle, or reopening. */
  live?: boolean;
  /** Why replies is empty when the thread did reply. */
  note?: string;
  error?: string;
  /** The id answers to `question` must name. */
  questionId?: string;
  question?: { index: number; question: string; options: string[] }[];
  cwd?: string;
  modelId?: string;
  reasoningEffort?: string;
  autonomy?: string;
}

export class ProjectService {
  private readonly projects = new Map<string, Project>();
  // Counts each project's holds, so a message on its way when one lands stays
  // withdrawn after Resume.
  private readonly holds = new WeakMap<Project, number>();
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
  private todoTimer?: NodeJS.Timeout;
  private historyLoaded = false;
  private spawnOrder = 0;
  private readonly restartRecovery = new Set<string>();
  private readonly approvalNotified = new Map<string, string>();
  private readonly pausing = new Map<Project, Promise<string[]>>();
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
        this.refill(project);
        this.refillRestartRecovery(project);
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
          return await this.openThread(project, thread, isCurrent);
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
        this.enqueue(project, message);
      },
      report: (project, thread, text, replyId, leadAlert) => {
        this.report(project, thread, text, replyId, leadAlert);
      },
      leadFailed: (project) => {
        this.leadFailed(project);
      },
      leadRecovered: (project) => {
        this.leadRecovered(project);
      },
      teamIdle: (project) => {
        this.teamIdle(project);
      },
      save: () => this.save(),
      fail: (project, error) => {
        this.fail(project, error);
      },
      wakes: this.wakes,
    });
    this.chats = new SpawnedChats(sessions);
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
        if (thread.queuedSpawn?.phase === 'opening') thread.queuedSpawn.phase = 'queued';
        owner.spawnOrder = Math.max(owner.spawnOrder, thread.queuedSpawn?.order ?? 0);
      }
      owner.wakes.kick(project);
    }
    if (saved.length) await owner.save();
    return owner;
  }

  list(): ProjectView[] {
    return [...this.projects.values()].map((project) => this.view(project));
  }

  private view(project: Project): ProjectView {
    const main = project.threads.find((thread) => !thread.ownerAppSessionId);
    const lead = main ? this.sessions.get(main.appSessionId) : undefined;
    const cwd = lead?.cwd;
    // A session's creation time can come from a file's birth time, which has a
    // fractional part; the renderer takes whole milliseconds only and drops the
    // whole event batch otherwise.
    const startedAt = Math.floor(project.startedAt ?? lead?.createdAt ?? 0);
    return {
      id: project.id,
      title: project.title,
      ...(startedAt ? { startedAt } : {}),
      ...(project.done ? { done: project.done } : {}),
      ...(cwd ? { cwd } : {}),
      paused: project.paused,
      ...(project.leadStopped ? { leadStopped: true as const } : {}),
      launching: project.launching,
      ...(project.brief !== undefined ? { brief: project.brief } : {}),
      plan: project.plan.map(({ milestone, note, ...step }) => ({
        ...step,
        ...(milestone ? { milestone } : {}),
        ...(note ? { note } : {}),
      })),
      todos: this.openTodos(project),
      runtimeLoad: this.sessions.runtimeLoad(),
      threads: project.threads.map((thread) => {
        const status = this.threadStatus(project, thread);
        return {
          appSessionId: thread.appSessionId,
          title: thread.title || 'Untitled thread',
          waiting: thread.waiting,
          ...(thread.unread ? { unread: true as const } : {}),
          state: status.state,
          ...(status.approval ? { approval: status.approval } : {}),
          ...(status.resetsAt !== undefined ? { resetsAt: status.resetsAt } : {}),
          ...(status.wait ? { wait: status.wait } : {}),
          ...(thread.ownerAppSessionId ? { ownerAppSessionId: thread.ownerAppSessionId } : {}),
        };
      }),
      queued: project.pending.length,
      uncertain: project.delivery?.state === 'uncertain' ? project.delivery.messages.length : 0,
      ...(project.error ? { error: project.error } : {}),
    };
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
          await this.bindThread(
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
      const thread = await this.enqueueThread(
        project,
        { ...input, title, ...(cwd ? { cwd } : {}), workspace },
        spawn.source,
        isCurrent,
      );
      if (thread.queuedSpawn?.phase === 'opening')
        await this.openThread(project, thread, isCurrent);
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
    const status = this.threadStatus(project, requireThread(project, appSessionId));
    const reuse = scopedThreads(project, spawn.source).find((thread) => {
      if (
        thread.appSessionId === appSessionId ||
        taskTitle(thread.title) !== taskTitle(input.title)
      )
        return false;
      const state = this.threadStatus(project, thread).state;
      return state === 'stopped' || state === 'idle' || state === 'queued';
    });
    const reuseNote = reuse
      ? `${reuse.title} (${reuse.appSessionId}) is ${this.threadStatus(project, reuse).state}; thread_send continues it instead of spawning another.`
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
      ...project.plan.map((step) => Number(step.id) || 0),
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
      const state = this.threadStatus(project, thread).state;
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
    return { threadId: target, answered: landed, state: this.threadStatus(project, thread).state };
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
      const holds = this.holds.get(project);
      const isCurrent = () =>
        !this.closed &&
        !project.paused &&
        this.holds.get(project) === holds &&
        this.membership.get(target) === project;
      this.sending.set(project, (this.sending.get(project) ?? 0) + 1);
      let steered: boolean;
      try {
        steered = await this.sessions.steer(target, prompt, isCurrent, delivery === 'interrupt');
      } finally {
        this.sending.set(project, (this.sending.get(project) ?? 1) - 1);
      }
      if (steered) {
        this.restartRecovery.delete(target);
        if (reopened) await this.save();
        return delivery === 'interrupt' ? 'interrupt' : 'steered';
      }
      // Its turn ended, or was stopped, while this was on its way. Starting a
      // new turn could undo a Stop, so the lead decides.
      throw new Error(
        `${thread.title}'s turn ended before it took this message. Read it with thread_read, and send again if the message still applies.`,
      );
    }
    const resumed = !this.sessions.isLive(target) || this.sessions.get(target)?.phase === 'paused';
    const message = this.enqueue(project, { from: source, to: target, kind: 'message', text });
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

  /**
   * The whole of a thread, for the chat that owns it: what it replied, the
   * question it is waiting on, and what it is running as. A report carries an
   * excerpt, so this is how a lead reads the rest or looks again later. It asks
   * for how far back it wants to read: one answer by default, never the lot.
   */
  async readFull(source: string, target: string): Promise<ThreadReadout> {
    const read = this.read(source, target);
    const project = this.controlledProject(source, read.threadId);
    const thread = requireThread(project, read.threadId);
    const reply = thread.reply;
    const earlierReplies = thread.earlierReplies;
    const providerSessionId = this.sessions.get(read.threadId)?.providerSessionId;
    const updatedAt = this.sessions.get(read.threadId)?.updatedAt;
    const running = this.sessions.get(read.threadId)?.streaming === true;
    let limit = 200;
    let fullReply = '';
    let complete = false;
    while (!complete) {
      const events = await this.sessions.transcriptTail(read.threadId, limit);
      this.requireOpen();
      if (
        this.membership.get(read.threadId) !== project ||
        requireThread(project, read.threadId) !== thread ||
        thread.reply !== reply ||
        thread.earlierReplies !== earlierReplies ||
        this.sessions.get(read.threadId)?.providerSessionId !== providerSessionId ||
        (this.sessions.get(read.threadId)?.streaming === true) !== running ||
        this.sessions.get(read.threadId)?.updatedAt !== updatedAt
      )
        throw new Error(
          'Thread changed while reading its transcript. Read it again with thread_read.',
        );
      fullReply = latestSettledReply(events, running);
      const prompts = events.filter(
        (event) => event.role === 'primary' && event.author === 'user',
      ).length;
      complete = events.length < limit || (fullReply.length > 0 && prompts >= (running ? 2 : 1));
      limit *= 2;
    }
    return { ...read, replies: fullReply ? [fullReply] : [], moreReplies: 0, note: undefined };
  }

  read(source: string, target: string, replies = 1): ThreadReadout {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const thread = requireThread(project, target);
    const session = this.sessions.get(target);
    const selection = thread.queuedSpawn?.input ?? session;
    const kept = thread.reply ? [...(thread.earlierReplies ?? []), thread.reply] : [];
    const wanted = Math.min(Math.max(replies, 1), LEDGER_LIMITS.earlierReplies + 1);
    return {
      threadId: target,
      title: thread.title,
      ...this.threadStatus(project, thread),
      runtimeLoad: this.sessions.runtimeLoad(),
      replies: kept.slice(-wanted),
      moreReplies: Math.max(kept.length - wanted, 0),
      queued: this.queuedMessages(project, target),
      ...(session ? { live: this.sessions.isLive(target) } : {}),
      ...(thread.repliesShed
        ? {
            note: 'DROIDEX dropped its replies to keep the project ledger small. Read its latest settled final reply with thread_read full: true.',
          }
        : {}),
      ...(thread.error ? { error: thread.error } : {}),
      ...(thread.ask ? { questionId: thread.ask.requestId, question: thread.ask.questions } : {}),
      ...(selection
        ? {
            cwd: selection.cwd,
            modelId: selection.modelId,
            reasoningEffort: selection.reasoningEffort,
            autonomy: selection.autonomy,
          }
        : {}),
    };
  }

  async markRead(source: string, target: string): Promise<void> {
    target = this.resolveThreadId(source, target);
    const project = this.controlledProject(source, target);
    const thread = requireThread(project, target);
    if (!thread.unread) return;
    await this.save(undefined, thread);
  }

  listThreads(source: string, all = false) {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    const caller = requireThread(project, source);
    let omitted = 0;
    const threads = scopedThreads(project, source).flatMap((thread) => {
      const status = this.threadStatus(project, thread);
      const queued = this.queuedMessages(project, thread.appSessionId);
      if (
        !all &&
        (status.state === 'idle' || status.state === 'stopped') &&
        !thread.unread &&
        !this.hasUndeliveredReport(project, thread.appSessionId) &&
        !queued
      ) {
        omitted += 1;
        return [];
      }
      return [
        {
          threadId: thread.appSessionId,
          title: thread.title,
          ownerId: thread.ownerAppSessionId,
          state: status.state,
          ...(thread.unread ? { unread: true as const } : {}),
          ...(status.approval ? { approval: status.approval } : {}),
          ...(status.resetsAt !== undefined ? { resetsAt: status.resetsAt } : {}),
          ...(status.position ? { position: status.position } : {}),
          ...(status.waitReason ? { waitReason: status.waitReason } : {}),
          lastReply: thread.reply.replace(/\s+/g, ' ').trim().slice(0, 120),
          queued,
        },
      ];
    });
    return {
      threads,
      ...(omitted
        ? { summary: `${String(omitted)} inactive threads; pass all: true to list them` }
        : {}),
      runtimeLoad: this.sessions.runtimeLoad(),
      todos: caller.ownerAppSessionId ? [] : this.openTodos(project),
    };
  }

  /** Recovers the lead's agreement and current work without changing unread or starting work. */
  projectRead(source: string) {
    const project = this.requireLeadProject(source);
    const threads = this.listThreads(source);
    const current = project.plan.find((step) => step.state !== 'done');
    return {
      projectId: project.id,
      title: project.title,
      brief: project.brief ?? null,
      currentMilestone: current?.milestone ?? null,
      plan: project.plan.map((step) => ({ ...step, state: step.state ?? 'planned' })),
      decisions: project.plan
        .filter((step) => step.note)
        .map((step) => ({ stepId: step.id, note: step.note })),
      todos: threads.todos,
      unreadThreads: scopedThreads(project, source)
        .filter((thread) => thread.unread)
        .map((thread) => thread.appSessionId),
      threads: threads.threads,
      ...(threads.summary ? { summary: threads.summary } : {}),
      paused: project.paused,
      ...(project.leadStopped ? { leadStopped: true as const } : {}),
      ...(project.done ? { done: project.done } : {}),
    };
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
    const text = input.text.trim();
    if (!text || text.length > LEDGER_LIMITS.todoText)
      throw new Error(`To-dos must contain 1 to ${String(LEDGER_LIMITS.todoText)} characters.`);
    if (
      input.inMinutes !== undefined &&
      (!Number.isInteger(input.inMinutes) || input.inMinutes < 1 || input.inMinutes > 1440)
    )
      throw new Error('inMinutes must be a whole number from 1 to 1440.');
    if (input.at !== undefined && input.inMinutes !== undefined)
      throw new Error('Choose at or inMinutes for the reminder time, not both.');
    const at = input.at === undefined ? undefined : Date.parse(input.at);
    if (
      at !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.at ?? '') ||
        !Number.isFinite(at) ||
        at <= Date.now())
    )
      throw new Error('at must be a future ISO timestamp with a timezone.');
    if (project.todos.length >= LEDGER_LIMITS.todos)
      throw new Error(
        `This project already has ${String(LEDGER_LIMITS.todos)} open to-dos. Use todo_done before adding another.`,
      );
    const after = input.after ? this.resolveThreadId(source, input.after) : undefined;
    const todo: ProjectTodo = {
      id: randomUUID(),
      text,
      ...(after ? { after } : {}),
      ...(at !== undefined ? { dueAt: at } : {}),
      ...(input.inMinutes !== undefined ? { dueAt: Date.now() + input.inMinutes * 60_000 } : {}),
    };
    if (after && this.hasUndeliveredReport(project, after)) todo.due = true;
    project.todos.push(todo);
    delete project.done;
    await this.save();
    if (todo.due) this.wakes.kick(project);
    const result = { ...todo };
    delete result.notified;
    return result;
  }

  async doneTodo(source: string, id: string): Promise<void> {
    const project = this.requireLeadProject(source);
    if (!project.todos.some((todo) => todo.id === id))
      throw new Error('No open to-do has that id in this project.');
    project.todos = project.todos.filter((todo) => todo.id !== id);
    project.pending = project.pending.filter((message) => message.id !== id);
    await this.save();
  }

  private requireLeadProject(source: string): Project {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    if (requireThread(project, source).ownerAppSessionId)
      throw new Error('Only the chat that leads a project keeps its to-dos.');
    return project;
  }

  private hasUndeliveredReport(project: Project, target: string): boolean {
    if (requireThread(project, target).owedReport) return true;
    return [...project.pending, ...(project.delivery?.messages ?? [])].some(
      (message) => message.kind === 'result' && message.from === target,
    );
  }

  private openTodos(project: Project): Omit<ProjectTodo, 'notified'>[] {
    return project.todos
      .map((todo) => ({
        id: todo.id,
        text: todo.text,
        ...(todo.after ? { after: todo.after } : {}),
        ...(todo.dueAt !== undefined ? { dueAt: todo.dueAt } : {}),
        ...(todo.due ? { due: true as const } : {}),
      }))
      .sort((a, b) => Number(Boolean(b.due)) - Number(Boolean(a.due)));
  }

  private queuedMessages(project: Project, target: string): number {
    return (
      [...project.pending, ...(project.delivery?.messages ?? [])].filter(
        (message) => message.to === target,
      ).length + (this.sessions.get(target)?.pendingSteers?.length ?? 0)
    );
  }

  private threadStatus(project: Project, thread: ProjectThread) {
    const wait = this.wakes.waitReason(thread.appSessionId);
    const request = this.sessions.pendingApproval(thread.appSessionId);
    const approval = request
      ? {
          requestId: request.requestId,
          summary: (request.detail || request.title || 'Permission request').slice(
            0,
            LEDGER_LIMITS.threadError,
          ),
        }
      : undefined;
    const session = this.sessions.get(thread.appSessionId);
    const state = approval ? ('approval' as const) : threadState(thread, session, wait);
    let reason: string | undefined;
    if (approval && !project.paused && !wait) reason = `waiting on approval: ${approval.summary}`;
    else if (state === 'rate-limited') {
      const resetsAt = session?.usageLimit?.resetsAt;
      reason = resetsAt
        ? `rate-limited · send again after ${new Date(resetsAt).toISOString()}`
        : 'rate-limited · send again when the provider limit resets';
    } else
      reason = threadWaitReason(
        state,
        wait,
        this.sessions.runtimeLoad(),
        project.paused,
        this.queuedMessages(project, thread.appSessionId),
      );
    const targets = [...new Set(project.pending.map((message) => message.to))];
    const position =
      wait && wait.kind !== 'turn' ? wait.position : targets.indexOf(thread.appSessionId) + 1;
    return {
      state,
      ...(approval ? { approval } : {}),
      ...(state === 'rate-limited' && session?.usageLimit?.resetsAt !== undefined
        ? { resetsAt: session.usageLimit.resetsAt }
        : {}),
      ...(wait ? { wait } : {}),
      ...(reason ? { waitReason: reason } : {}),
      ...(position > 0 ? { position } : {}),
    };
  }

  private armTodoTimer(): void {
    if (this.todoTimer) clearTimeout(this.todoTimer);
    this.todoTimer = undefined;
    if (this.closed || !this.historyLoaded) return;
    let nextDueAt = Infinity;
    for (const project of this.projects.values())
      for (const todo of project.todos)
        if (!todo.due && todo.dueAt !== undefined) nextDueAt = Math.min(nextDueAt, todo.dueAt);
    if (nextDueAt === Infinity) return;
    this.todoTimer = setTimeout(
      () => {
        this.todoTimer = undefined;
        void this.wakeDueTodos().catch((error: unknown) => {
          console.error('Could not persist project follow-ups:', error);
        });
      },
      Math.min(2_147_483_647, Math.max(0, nextDueAt - Date.now())),
    );
    this.todoTimer.unref();
  }

  private async wakeDueTodos(): Promise<void> {
    if (this.closed) return;
    const dueProjects: Project[] = [];
    const now = Date.now();
    for (const project of this.projects.values()) {
      let changed = false;
      for (const todo of project.todos) {
        if (todo.due || todo.dueAt === undefined || todo.dueAt > now) continue;
        todo.due = true;
        changed = true;
      }
      if (changed) {
        this.refill(project);
        dueProjects.push(project);
      }
    }
    await this.save();
    for (const project of dueProjects)
      if (this.projects.get(project.id) === project) this.wakes.kick(project);
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
    this.wakes.invalidateTarget(target);
    await this.sessions.interrupt(target);
    return this.quiet(project, target);
  }

  async setPaused(id: string, paused: boolean, acknowledgeDelivery = false): Promise<void> {
    this.requireOpen();
    const project = this.projects.get(id);
    if (!project) throw new Error('Project not found.');
    if (paused) await this.pauseProject(project);
    else await this.resumeProject(project, acknowledgeDelivery);
  }

  async pause(source: string): Promise<{ interrupted: string[] }> {
    const project = this.requireLeadProject(source);
    return { interrupted: await this.pauseProject(project, source) };
  }

  async resume(source: string): Promise<{ resumed: string[] }> {
    const project = this.requireLeadProject(source);
    return { resumed: await this.resumeProject(project) };
  }

  private pauseProject(project: Project, caller?: string): Promise<string[]> {
    const pending = this.pausing.get(project);
    if (pending) {
      this.noteHold(project);
      return pending;
    }
    const work = this.interruptProject(project, caller).finally(() => this.pausing.delete(project));
    this.pausing.set(project, work);
    return work;
  }

  private async interruptProject(project: Project, caller?: string): Promise<string[]> {
    this.wakes.invalidate(project);
    this.noteHold(project);
    project.paused = true;
    const interrupted = project.threads
      .filter(
        (thread) =>
          thread.appSessionId !== caller && this.sessions.get(thread.appSessionId)?.streaming,
      )
      .map((thread) => thread.appSessionId);
    project.interrupted = [...new Set([...(project.interrupted ?? []), ...interrupted])];
    const stopping = Promise.allSettled(interrupted.map((id) => this.sessions.interrupt(id)));
    await this.save();
    if (this.closed) return interrupted;
    const stopped = await stopping;
    this.requireOpen();
    await this.save();
    const failure = stopped.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return interrupted;
  }

  private async resumeProject(project: Project, acknowledgeDelivery = false): Promise<string[]> {
    const holds = this.holds.get(project);
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    const leadCurrent = lead ? this.wakes.targetGuard(lead.appSessionId) : () => true;
    const pausing = this.pausing.get(project);
    if (pausing) await pausing;
    this.requireOpen();
    if (this.holds.get(project) !== holds)
      throw new Error(
        'A newer Pause canceled this Resume. Resume again when you want work to continue.',
      );
    if (!leadCurrent() && project.interrupted)
      project.interrupted = project.interrupted.filter((id) => id !== lead?.appSessionId);
    if (project.delivery) {
      if (project.delivery.state === 'sending')
        throw new Error('A delivery is settling. Try resuming again.');
      if (!acknowledgeDelivery)
        throw new Error('Review the uncertain delivery before resuming without replay.');
      delete project.delivery;
    }
    const shouldWake = project.paused || (project.leadStopped ?? project.leadFailed);
    this.wakes.invalidate(project);
    project.paused = false;
    if (leadCurrent()) {
      delete project.leadStopped;
      delete project.leadFailed;
    }
    if (!project.leadFailed) delete project.error;
    const resumed = [...(project.interrupted ?? [])];
    if (
      shouldWake &&
      lead &&
      !project.pending.some((message) => message.to === lead.appSessionId)
    ) {
      const unread = unreadThreadNote(project);
      if (unread) {
        if (!inboxFull(project))
          this.enqueue(project, {
            from: lead.appSessionId,
            to: lead.appSessionId,
            kind: 'message',
            text: unread,
          });
      } else if (!this.sessions.get(lead.appSessionId)?.streaming) project.wakePending = 'resume';
    }
    this.refill(project);
    this.refillRestartRecovery(project);
    await this.save();
    this.wakes.kick(project);
    return resumed;
  }

  private refillInterrupted(project: Project): void {
    if (project.paused || !project.interrupted?.length) return;
    for (const id of [...project.interrupted]) {
      const thread = requireThread(project, id);
      const queued = [...project.pending, ...(project.delivery?.messages ?? [])].some(
        (message) => message.to === id && message.kind === 'message',
      );
      if (!queued) {
        if (inboxFull(project)) continue;
        this.enqueue(project, {
          from: thread.ownerAppSessionId ?? id,
          to: id,
          kind: 'message',
          text: this.restartRecovery.has(id)
            ? 'DROIDEX restarted while you were working. Continue from where you stopped; your worktree and history are intact.'
            : 'The project resumed. Continue the work interrupted by project Pause from where you stopped.',
        });
      }
      project.interrupted = project.interrupted.filter((target) => target !== id);
    }
    if (!project.interrupted.length) delete project.interrupted;
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
      this.enqueue(project, { from: source, to: threadId, kind: 'message', text: note });
    await this.save();
    this.wakes.available(project, threadId);
    return { state: this.threadStatus(project, thread).state };
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
    if (!requireThread(project, appSessionId).ownerAppSessionId) {
      project.leadStopped = true;
      delete project.leadFailed;
      this.wakes.invalidateTarget(appSessionId);
      await this.save();
      return;
    }
    this.wakes.invalidateTarget(appSessionId);
    await this.quiet(project, appSessionId);
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
    await this.turns.observe(event);
    if (reopened) await this.save();
    // A delivered turn that stops on the user's approval frees its slot.
    if (event.type === 'approval.requested') {
      const project = this.membership.get(event.request.appSessionId);
      if (project) {
        this.refillApprovals(project);
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
      this.restartRecovery.delete(session.appSessionId);
      this.streamingSessions.add(session.appSessionId);
      return false;
    }
    return this.streamingSessions.delete(session.appSessionId);
  }

  /** Session history knows every thread now, so what a restart left queued can go out. */
  historyReady(): void {
    void this.recoverAfterRestart().then(
      () => {
        if (this.closed) return;
        this.historyLoaded = true;
        this.wakes.start(this.projects.values());
        this.armTodoTimer();
      },
      (error: unknown) => {
        for (const project of this.projects.values()) this.fail(project, error);
      },
    );
  }

  private async recoverAfterRestart(): Promise<void> {
    for (const project of this.projects.values()) {
      if (this.closed) continue;
      for (const thread of project.threads) {
        if (!thread.ownerAppSessionId || thread.queuedSpawn || thread.stopped) continue;
        const session = this.sessions.get(thread.appSessionId);
        if (
          session?.interruptReason?.startsWith(TURN_INTERRUPTED) &&
          !session.streaming &&
          session.phase === 'paused'
        )
          this.restartRecovery.add(thread.appSessionId);
      }
      this.refillRestartRecovery(project);
      this.teamIdle(project);
    }
    if (
      this.restartRecovery.size ||
      [...this.projects.values()].some((project) => project.pending.length || project.wakePending)
    )
      await this.save();
  }

  private refillRestartRecovery(project: Project): void {
    if (project.paused) return;
    for (const thread of project.threads) {
      if (!this.restartRecovery.has(thread.appSessionId) || !thread.ownerAppSessionId) continue;
      const alreadyQueued = [...project.pending, ...(project.delivery?.messages ?? [])].some(
        (message) => message.to === thread.appSessionId && message.kind === 'message',
      );
      if (alreadyQueued) {
        this.restartRecovery.delete(thread.appSessionId);
        continue;
      }
      // Check every thread even when full: an existing instruction replaces recovery.
      if (inboxFull(project)) continue;
      this.enqueue(project, {
        from: thread.ownerAppSessionId,
        to: thread.appSessionId,
        kind: 'message',
        text: 'DROIDEX restarted while you were working. Continue from where you stopped; your worktree and history are intact.',
      });
    }
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
    if (this.todoTimer) clearTimeout(this.todoTimer);
    this.todoTimer = undefined;
    this.restartRecovery.clear();
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
  private async quiet(project: Project, target: string): Promise<'stopped' | 'cancelled'> {
    await this.wakes.settle(project);
    const thread = requireThread(project, target);
    clearAsk(project, thread);
    if (project.interrupted) {
      project.interrupted = project.interrupted.filter((id) => id !== target);
      if (!project.interrupted.length) delete project.interrupted;
    }
    // A stopped thread stays stopped: no continuation after a restart either.
    thread.stopped = true;
    this.restartRecovery.delete(target);
    const queued = thread.queuedSpawn;
    const checkoutOwner = queued?.workspace
      ? this.requireSession(thread.ownerAppSessionId ?? '')
      : undefined;
    if (queued) {
      delete thread.queuedSpawn;
      project.threads = project.threads.filter((candidate) => candidate !== thread);
      this.membership.delete(target);
      for (const step of project.plan)
        if (step.threadAppSessionId === target) delete step.threadAppSessionId;
      for (const todo of project.todos) if (todo.after === target) delete todo.after;
    }
    project.pending = project.pending.filter((message) => message.to !== target);
    for (const thread of project.threads)
      if (thread.ownerAppSessionId === target) delete thread.owedReport;
    await this.save();
    if (queued?.workspace && checkoutOwner)
      await discardThreadCheckout(checkoutOwner.cwd, queued.workspace);
    this.wakes.kick(project);
    return queued ? 'cancelled' : 'stopped';
  }

  private async enqueueThread(
    project: Project,
    { workspace, ...input }: ThreadLaunchInput,
    ownerAppSessionId: string,
    isCurrent: () => boolean,
  ): Promise<ProjectThread> {
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
    const load = this.sessions.runtimeLoad();
    const phase = load.live >= load.limit || this.wakes.hasWaitingStarts() ? 'queued' : 'opening';
    const thread: ProjectThread = {
      appSessionId: randomUUID(),
      ownerAppSessionId,
      title: input.title,
      reply: '',
      waiting: false,
      queuedSpawn: { phase, input, order: ++this.spawnOrder, workspace },
    };
    if (phase === 'queued') this.commitAdoption(ownerAppSessionId, project);
    delete project.done;
    project.threads.push(thread);
    this.membership.set(thread.appSessionId, project);
    try {
      await this.save(project);
      if (!isCurrent()) throw new Error('Project launch was cancelled.');
      return thread;
    } catch (error) {
      project.threads = project.threads.filter((candidate) => candidate !== thread);
      this.membership.delete(thread.appSessionId);
      await this.save(project);
      throw error;
    }
  }

  private async openThread(
    project: Project,
    thread: ProjectThread,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    const projectCurrent = isCurrent;
    const targetCurrent = this.wakes.guard(project, thread.appSessionId);
    isCurrent = () => projectCurrent() && targetCurrent();
    const queued = thread.queuedSpawn;
    const owner = thread.ownerAppSessionId;
    if (!queued || !owner) throw new Error('Only an identified, unstarted thread can open.');
    const wasQueued = queued.phase === 'queued';
    let opened = false;
    queued.phase = 'opening';
    const { input, workspace } = queued;
    project.launching += 1;
    try {
      await this.save(project);
      if (!isCurrent()) throw new Error('Project launch was cancelled.');
      const session = await this.sessions.create(
        { ...input, prompt: `${THREAD_BRIEF}\n\nTask:\n${threadPrompt(input.prompt, workspace)}` },
        async (created) => {
          checkWithinAutonomy(this.requireSession(owner), input.autonomy);
          if (created.appSessionId !== thread.appSessionId)
            throw new Error('The harness changed the thread identity.');
          await this.bindThread(project, thread, isCurrent);
        },
        undefined,
        thread.appSessionId,
      );
      if (session === null) {
        this.commitAdoption(owner, project);
        return false;
      }
      if (!session)
        throw new Error('The selected harness did not start this thread and reported no reason.');
      opened = true;
      return true;
    } catch (error) {
      if (wasQueued && isCurrent()) {
        queued.phase = 'failed';
        thread.queuedSpawn = queued;
        thread.error = (error instanceof Error ? error.message : String(error)).slice(
          0,
          LEDGER_LIMITS.threadError,
        );
        this.report(project, thread, failureReport(thread.title, thread.error), undefined, true);
        return true;
      }
      if (!wasQueued) {
        project.threads = project.threads.filter((candidate) => candidate !== thread);
        this.membership.delete(thread.appSessionId);
      }
      throw error;
    } finally {
      if (thread.queuedSpawn?.phase === 'opening' && !opened) thread.queuedSpawn.phase = 'queued';
      project.launching -= 1;
      await this.save(project);
    }
  }

  private async bindThread(project: Project, thread: ProjectThread, isCurrent: () => boolean) {
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
    if (!project.threads.includes(thread)) project.threads.push(thread);
    this.membership.set(thread.appSessionId, project);
    if (thread.ownerAppSessionId) this.commitAdoption(thread.ownerAppSessionId, project);
    // Name it before its first turn, so its own plan_set title wins.
    await this.sessions.rename(thread.appSessionId, thread.title).catch((error: unknown) => {
      console.warn(`Could not name project thread ${thread.appSessionId}:`, error);
    });
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
    await this.save(project);
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
  }

  /* A report that finds the inbox full waits on its thread and queues as soon as
     a delivery makes room. A newer report from the same thread replaces it. */
  private report(
    project: Project,
    thread: ProjectThread,
    text: string,
    replyId?: string,
    leadAlert = false,
  ): void {
    const owner = thread.ownerAppSessionId;
    if (!owner) return;
    requireMessageText(text);
    const recipients = [owner];
    const lead = project.threads.find((candidate) => !candidate.ownerAppSessionId);
    if (leadAlert && lead && lead.appSessionId !== owner) recipients.push(lead.appSessionId);
    for (const todo of project.todos) {
      if (todo.after !== thread.appSessionId || todo.due) continue;
      todo.due = true;
      // A direct report already wakes the lead with this follow-up attached.
      if (!requireThread(project, owner).ownerAppSessionId) todo.notified = true;
    }
    const queued = project.pending.length + (project.delivery?.messages.length ?? 0);
    if (queued + recipients.length > LEDGER_LIMITS.inbox) {
      thread.owedReport = { text, replyId };
      if (recipients.length > 1) thread.owedLeadAlert = true;
      else delete thread.owedLeadAlert;
      return;
    }
    for (const to of recipients)
      this.enqueue(project, { from: thread.appSessionId, to, kind: 'result', text, replyId });
    delete thread.owedReport;
    delete thread.owedLeadAlert;
  }

  private refill(project: Project): void {
    if (this.closed) return;
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (lead && project.wakePending && !inboxFull(project)) {
      this.enqueue(project, {
        from: lead.appSessionId,
        to: lead.appSessionId,
        kind: 'idle',
        text:
          project.wakePending === 'resume'
            ? 'The project resumed. Review retained reports and continue interrupted work.'
            : 'The team is idle while project work remains. Review the plan and open to-dos, then continue existing threads with thread_send or decide the next work.',
      });
      delete project.wakePending;
    }
    this.refillInterrupted(project);
    for (const thread of project.threads) {
      if (inboxFull(project)) return;
      const report = thread.owedReport;
      if (report) this.report(project, thread, report.text, report.replyId, thread.owedLeadAlert);
    }
    if (!lead) return;
    this.refillApprovals(project);
    for (const todo of project.todos) {
      if (inboxFull(project)) return;
      if (!todo.due || todo.notified) continue;
      project.pending.push({
        id: todo.id,
        from: lead.appSessionId,
        to: lead.appSessionId,
        kind: 'message',
        text: `Reminder — follow-up due (to-do ${todo.id}): ${todo.text}`,
      });
      todo.notified = true;
    }
  }

  private refillApprovals(project: Project): void {
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (!lead) return;
    for (const thread of project.threads) {
      if (!thread.ownerAppSessionId) continue;
      const request = this.sessions.pendingApproval(thread.appSessionId);
      if (
        !request ||
        this.approvalNotified.get(thread.appSessionId) === request.requestId ||
        inboxFull(project)
      )
        continue;
      this.enqueue(project, {
        from: thread.appSessionId,
        to: lead.appSessionId,
        kind: 'approval',
        approvalId: request.requestId,
        text: `Waiting on approval: ${(request.detail || request.title || 'Permission request').slice(0, LEDGER_LIMITS.threadError)}. Decide with thread_approve, or ask the user one question if it exceeds your autonomy.`,
      });
      this.approvalNotified.set(thread.appSessionId, request.requestId);
    }
  }

  private teamIdle(project: Project): void {
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (!lead || project.done || this.sessions.get(lead.appSessionId)?.streaming) return;
    const workRemains =
      project.plan.some((step) => step.state !== 'done') ||
      project.todos.length > 0 ||
      project.pending.length > 0;
    if (
      !workRemains ||
      project.launching ||
      [...project.pending, ...(project.delivery?.messages ?? [])].some(
        (message) => message.kind === 'message' && message.to !== lead.appSessionId,
      ) ||
      project.threads.some(
        (thread) =>
          thread.ownerAppSessionId &&
          (thread.queuedSpawn !== undefined ||
            this.sessions.get(thread.appSessionId)?.streaming === true),
      )
    )
      return;
    if (
      project.pending.some((message) => message.to === lead.appSessionId) ||
      project.delivery?.messages.some((message) => message.to === lead.appSessionId) ||
      project.threads.some(
        (thread) =>
          thread.owedReport &&
          (thread.ownerAppSessionId === lead.appSessionId || thread.owedLeadAlert),
      )
    )
      return;
    project.wakePending = 'team-idle';
    this.refill(project);
  }

  private enqueue(project: Project, message: Omit<ThreadMessage, 'id'>): ThreadMessage {
    this.requireOpen();
    requireMessageText(message.text);
    if (inboxFull(project))
      throw new Error(
        `The project inbox is full: ${String(LEDGER_LIMITS.inbox)} messages are waiting for their threads, and nothing more can queue until they are delivered.`,
      );
    const target = project.threads.find((thread) => thread.appSessionId === message.to);
    if (message.kind === 'message' && target?.queuedSpawn?.phase === 'failed') {
      target.queuedSpawn.phase = 'queued';
      delete target.error;
    }
    const queued = { id: randomUUID(), ...message };
    project.pending.push(queued);
    if (message.kind === 'message') this.restartRecovery.delete(message.to);
    return queued;
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

  private noteHold(project: Project): void {
    this.holds.set(project, (this.holds.get(project) ?? 0) + 1);
  }

  private fail(project: Project, error: unknown): void {
    this.wakes.invalidate(project);
    this.noteHold(project);
    project.paused = true;
    delete project.leadStopped;
    delete project.leadFailed;
    const message = error instanceof Error ? error.message : String(error);
    project.error = message.slice(0, LEDGER_LIMITS.projectError);
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }

  private async save(affectedProject?: Project, readThread?: ProjectThread): Promise<void> {
    let projects = [...this.projects.values()];
    fitLedger(projects, (appSessionId) => this.sessions.get(appSessionId)?.updatedAt ?? 0);
    const readProject = readThread ? this.membership.get(readThread.appSessionId) : undefined;
    const readReplyId = readThread?.replyId;
    if (readThread)
      projects = projects.map((project) => {
        if (project !== readProject) return project;
        return {
          ...project,
          threads: project.threads.map((thread) => {
            if (thread !== readThread) return thread;
            const saved = { ...thread };
            delete saved.unread;
            return saved;
          }),
        };
      });
    try {
      await this.store.save(projects);
    } catch (error) {
      if (affectedProject) this.fail(affectedProject, error);
      else for (const project of this.projects.values()) this.fail(project, error);
      throw error;
    }
    // A failed save or a reply arriving during it must keep the live unread flag.
    if (
      !this.closed &&
      readThread &&
      this.membership.get(readThread.appSessionId) === readProject &&
      readThread.replyId === readReplyId
    )
      delete readThread.unread;
    this.armTodoTimer();
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }
}

/** The inbox counts what a delivery has claimed, so its limit holds while that delivery is out. */
function inboxFull(project: Project): boolean {
  return project.pending.length + (project.delivery?.messages.length ?? 0) >= LEDGER_LIMITS.inbox;
}

function requireMessageText(text: string): void {
  if (!text.trim() || text.length > LEDGER_LIMITS.text)
    throw new Error(`Thread messages must contain 1 to ${String(LEDGER_LIMITS.text)} characters.`);
}

function taskTitle(title: string): string {
  return title
    .replace(/(?:\s+\d+|\s*\(retry\))$/i, '')
    .trim()
    .toLowerCase();
}
