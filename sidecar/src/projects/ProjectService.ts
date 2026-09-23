import type { AutomationDeliveryReceipt } from '../automations/types.js';
import { ProjectWakeQueue } from './ProjectWakeQueue.js';
import {
  clearAsk,
  MAX_EARLIER_REPLIES,
  ProjectTurns,
  requireThread,
  threadState,
} from './projectTurns.js';
import { randomUUID } from 'node:crypto';
import type { ProviderStatus, ServerEvent, SessionSummary } from '../protocol.js';
import type { ProjectPersistence } from './store.js';
import {
  discardThreadCheckout,
  inheritSettings,
  LEAD_BRIEF,
  THREAD_BRIEF,
  resolveModel,
  threadCheckout,
  threadPrompt,
  uniqueTitle,
} from './threadStart.js';
import type {
  Project,
  ProjectStep,
  ProjectThread,
  ProjectView,
  ThreadInput,
  ThreadMessage,
  ThreadSettings,
  ThreadSpawnInput,
} from './types.js';

export interface ProjectPort {
  get(appSessionId: string): SessionSummary | undefined;
  /** What each provider can run right now, so a spawn cannot name a model that is not there. */
  catalog(): Promise<ProviderStatus[]>;
  create(
    input: ThreadInput,
    bind: (session: SessionSummary) => Promise<void>,
  ): Promise<SessionSummary | undefined>;
  deliver(
    appSessionId: string,
    prompt: string,
    isCurrent: () => boolean,
  ): Promise<AutomationDeliveryReceipt>;
  interrupt(appSessionId: string): Promise<void>;
  /** Whether a question routed to an owner is still waiting on its thread. */
  isAsking(appSessionId: string, requestId: string): boolean;
  /** Retunes a live thread, the way the composer's own controls do. */
  configure(appSessionId: string, settings: ThreadSettings): Promise<void>;
  /** Answers a question a thread is blocked on; false when it was already settled. */
  answer(
    appSessionId: string,
    requestId: string,
    answers: { index: number; question: string; answer: string }[],
  ): boolean;
}

/** What a chat reads back about a thread it owns. */
type ThreadState = 'working' | 'waiting' | 'stopped' | 'failed' | 'idle';

export interface ThreadReadout {
  threadId: string;
  title: string;
  state: ThreadState;
  /** The replies asked for, oldest first; the latest one alone by default. */
  replies: string[];
  /** Older replies DROIDEX still holds, for an owner that wants more context. */
  moreReplies: number;
  error?: string;
  question?: { index: number; question: string; options: string[] }[];
  cwd?: string;
  modelId?: string;
  reasoningEffort?: string;
  autonomy?: string;
}

const autonomy = ['off', 'low', 'medium', 'high'];
export class ProjectService {
  private readonly projects = new Map<string, Project>();
  private readonly membership = new Map<string, Project>();
  private readonly launches = new Set<Promise<string>>();
  private readonly wakes: ProjectWakeQueue;
  private readonly turns: ProjectTurns;
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
    );
    this.turns = new ProjectTurns({
      project: (appSessionId) => this.membership.get(appSessionId),
      isAsking: (appSessionId, requestId) => sessions.isAsking(appSessionId, requestId),
      enqueue: (project, from, to, kind, text) => {
        this.enqueue(project, from, to, kind, text);
      },
      save: () => this.save(),
      fail: (project, error) => {
        this.fail(project, error);
      },
      wakes: this.wakes,
    });
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
      // Only a delivery caught mid-flight is uncertain, and only that needs a
      // person to look before coordination goes on. Holding every project over
      // a restart stopped them all silently: a thread would answer, its report
      // would queue, and the lead would never be woken for it.
      if (project.delivery) {
        project.delivery.state = 'uncertain';
        project.paused = true;
      }
      owner.projects.set(project.id, project);
      for (const thread of project.threads) owner.membership.set(thread.appSessionId, project);
    }
    if (saved.length) await owner.save();
    return owner;
  }

  list(): ProjectView[] {
    return [...this.projects.values()].map((project) => this.view(project));
  }

  private view(project: Project): ProjectView {
    const main = project.threads.find((thread) => !thread.ownerAppSessionId);
    const cwd = main ? this.sessions.get(main.appSessionId)?.cwd : undefined;
    return {
      id: project.id,
      title: project.title,
      ...(cwd ? { cwd } : {}),
      paused: project.paused,
      launching: project.launching,
      plan: project.plan,
      threads: project.threads.map((thread) => ({
        appSessionId: thread.appSessionId,
        title: thread.title,
        waiting: thread.waiting,
        ...(thread.ownerAppSessionId ? { ownerAppSessionId: thread.ownerAppSessionId } : {}),
      })),
      queued: project.pending.length,
      uncertain: project.delivery?.state === 'uncertain' ? project.delivery.messages.length : 0,
      uncertainTargets:
        project.delivery?.state === 'uncertain'
          ? [...new Set(project.delivery.messages.map((message) => message.to))]
          : [],
      ...(project.error ? { error: project.error } : {}),
    };
  }

  /** Starts a project and its lead; the caller opens that conversation. */
  async create(
    input: ThreadInput,
    requestId?: string,
  ): Promise<{ projectId: string; appSessionId?: string }> {
    this.requireOpen();
    const existing = requestId ? this.projects.get(requestId) : undefined;
    if (existing) {
      // A repeat of a request whose lead is still starting waits for it, so the
      // caller is told which conversation to open rather than a bare id.
      if (existing.launching > 0) await Promise.allSettled([...this.launches]);
      const main = existing.threads.find((thread) => !thread.ownerAppSessionId);
      return { projectId: existing.id, ...(main ? { appSessionId: main.appSessionId } : {}) };
    }
    const project = this.newProject(input.title, requestId);
    try {
      const appSessionId = await this.launch(project, input);
      return { projectId: project.id, appSessionId };
    } catch (error) {
      this.fail(project, error);
      if (!project.threads.length) {
        this.projects.delete(project.id);
        await this.save();
      }
      throw error;
    }
  }

  async spawn(
    source: string,
    requested: ThreadSpawnInput,
  ): Promise<{
    appSessionId: string;
    title: string;
    cwd?: string;
    branch?: string;
    step?: string;
  }> {
    this.requireOpen();
    const owner = this.requireSession(source);
    if (owner.sessionPurpose !== 'chat')
      throw new Error('Only ordinary chats can own project threads.');
    const input = resolveModel(
      await this.sessions.catalog(),
      owner,
      inheritSettings(owner, requested),
    );
    this.checkAutonomy(owner, input);
    let project = this.membership.get(source);
    if (!project) {
      project = this.newProject(owner.title);
      project.threads.push({
        appSessionId: source,
        title: owner.title.slice(0, 120) || 'Main conversation',
        reply: '',
        waiting: false,
      });
      this.membership.set(source, project);
    }
    let ancestor: string | undefined = source;
    let depth = 0;
    while (ancestor) {
      depth += 1;
      ancestor = this.thread(project, ancestor).ownerAppSessionId;
    }
    if (depth >= 4) throw new Error('Project thread nesting is limited to three levels.');
    // Everything a spawn can be refused for is checked before its checkout is
    // cut, because a worktree for a thread that never starts is left on disk
    // with nothing to say it was ours: a bad step name, a held project or a
    // full one would each strand one.
    this.checkAdmission(project);
    const named = requested.step ? this.planStep(project, requested.step).title : undefined;
    // The slot is held while the checkout is cut, so a parallel spawn cannot
    // pass the same cap, and it is handed to the launch without a gap.
    project.launching += 1;
    let workspace: Awaited<ReturnType<typeof threadCheckout>>;
    try {
      workspace = await threadCheckout(
        project,
        (id) => this.sessions.get(id),
        owner.cwd,
        input.title,
        requested,
      );
    } finally {
      project.launching -= 1;
    }
    const cwd = workspace?.cwd ?? owner.cwd;
    const prompt = threadPrompt(input.prompt, workspace);
    const title = uniqueTitle(project, input.title);
    let appSessionId: string;
    try {
      appSessionId = await this.launch(project, { ...input, title, prompt, cwd }, source);
    } catch (error) {
      if (workspace) await discardThreadCheckout(owner.cwd, workspace);
      throw error;
    }
    // Looked up again: plan_set may have replaced the plan while the thread
    // started, and the step resolved with it.
    const step = named ? project.plan.find((candidate) => candidate.title === named) : undefined;
    if (step) {
      step.threadAppSessionId = appSessionId;
      delete step.state;
      await this.save();
    }
    return {
      appSessionId,
      title,
      ...(workspace ? { cwd: workspace.cwd, branch: workspace.branch } : {}),
      ...(step ? { step: step.title } : {}),
    };
  }

  /** The plan step a spawn says it carries, by its number or its exact title. */
  private planStep(project: Project, step: string): ProjectStep {
    const wanted = step.trim();
    const found = project.plan.find(
      (candidate) => candidate.id === wanted || candidate.title === wanted,
    );
    if (!found) {
      throw new Error(
        project.plan.length
          ? `No plan step called "${wanted}". Call plan_set first, then spawn for a step it holds.`
          : 'This project has no plan yet. Call plan_set with the steps you mean to take, then spawn for one of them.',
      );
    }
    return found;
  }

  /**
   * Replaces the plan the lead keeps for a project. Steps are the lead's words;
   * a step that names a thread must name one of this project's own, so the table
   * can follow that conversation's real state instead of a claim.
   */
  async setPlan(source: string, steps: readonly Omit<ProjectStep, 'id'>[]): Promise<number> {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    if (this.thread(project, source).ownerAppSessionId)
      throw new Error('Only the project’s main chat keeps its plan.');
    if (steps.length > 60) throw new Error('A project plan holds at most 60 steps.');
    project.plan = steps.map((step, index) => {
      if (step.threadAppSessionId) this.thread(project, step.threadAppSessionId);
      return {
        id: String(index + 1),
        title: step.title.slice(0, 200),
        ...(step.milestone ? { milestone: step.milestone.slice(0, 80) } : {}),
        ...(step.state ? { state: step.state } : {}),
        ...(step.threadAppSessionId ? { threadAppSessionId: step.threadAppSessionId } : {}),
        ...(step.note ? { note: step.note.slice(0, 400) } : {}),
      };
    });
    await this.save();
    return project.plan.length;
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

  /**
   * Sends a thread instructions, or the answers to the question it asked. A
   * queued message would sit behind that question, so answers go straight to
   * the harness call waiting on it.
   */
  async send(
    source: string,
    target: string,
    text: string,
    answers?: string[],
  ): Promise<'answered' | 'queued' | 'already-answered'> {
    const project = this.controlledProject(source, target);
    const thread = this.thread(project, target);
    const ask = thread.ask;
    if (ask && !answers?.length)
      throw new Error(
        `${thread.title} is waiting on the question it asked. Send its answers with this thread's answers argument.`,
      );
    if (answers?.length) {
      if (!ask) throw new Error(`${thread.title} has no question waiting for an answer.`);
      if (answers.length !== ask.questions.length)
        throw new Error(
          `${thread.title} asked ${String(ask.questions.length)} questions; answer them all, in order.`,
        );
      const landed = this.sessions.answer(
        target,
        ask.requestId,
        ask.questions.map((item, position) => ({
          index: item.index,
          question: item.question,
          answer: answers[position],
        })),
      );
      clearAsk(project, thread);
      // Words sent with an answer are instructions of their own and reach the
      // thread either way: alongside an answer that landed, or in place of one
      // the thread had already settled without.
      if (text.trim()) this.enqueue(project, source, target, 'message', text);
      await this.save();
      this.wakes.kick(project);
      return landed ? 'answered' : 'already-answered';
    }
    this.enqueue(project, source, target, 'message', text);
    await this.save();
    this.wakes.kick(project);
    return 'queued';
  }

  /**
   * The whole of a thread, for the chat that owns it: what it replied, the
   * question it is waiting on, and what it is running as. A report carries an
   * excerpt, so this is how a lead reads the rest or looks again later. It asks
   * for how far back it wants to read — one answer by default, never the lot.
   */
  read(source: string, target: string, replies = 1): ThreadReadout {
    const project = this.controlledProject(source, target);
    const thread = this.thread(project, target);
    const session = this.sessions.get(target);
    const kept = thread.reply ? [...(thread.earlierReplies ?? []), thread.reply] : [];
    const wanted = Math.min(Math.max(replies, 1), MAX_EARLIER_REPLIES + 1);
    return {
      threadId: target,
      title: thread.title,
      state: threadState(thread, session),
      replies: kept.slice(-wanted),
      moreReplies: Math.max(kept.length - wanted, 0),
      ...(thread.error ? { error: thread.error } : {}),
      ...(thread.ask ? { question: thread.ask.questions } : {}),
      ...(session
        ? {
            cwd: session.cwd,
            modelId: session.modelId,
            reasoningEffort: session.reasoningEffort,
            autonomy: session.autonomy,
          }
        : {}),
    };
  }

  /** Retunes a thread within the owner's own limits, and reads back what took. */
  async configure(
    source: string,
    target: string,
    settings: ThreadSettings,
  ): Promise<ThreadReadout> {
    const project = this.controlledProject(source, target);
    const owner = this.requireSession(source);
    const session = this.requireSession(target);
    const wanted = settings.modelId
      ? resolveModel(await this.sessions.catalog(), owner, {
          title: '',
          prompt: '',
          provider: session.provider,
          autonomy: session.autonomy,
          modelId: settings.modelId,
        }).modelId
      : undefined;
    if (settings.autonomy && autonomy.indexOf(settings.autonomy) > autonomy.indexOf(owner.autonomy))
      throw new Error('A thread cannot exceed its owner’s autonomy.');
    await this.sessions.configure(target, {
      ...(wanted ? { modelId: wanted } : {}),
      ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
      ...(settings.autonomy ? { autonomy: settings.autonomy } : {}),
    });
    this.wakes.kick(project);
    return this.read(source, target);
  }

  async stop(source: string, target: string): Promise<void> {
    const project = this.controlledProject(source, target);
    this.wakes.invalidate(project);
    await this.sessions.interrupt(target);
    await this.quiet(project, target);
  }

  async setPaused(id: string, paused: boolean, acknowledgeDelivery = false): Promise<void> {
    this.requireOpen();
    const project = this.projects.get(id);
    if (!project) throw new Error('Project not found.');
    if (!paused && project.delivery) {
      if (project.delivery.state === 'sending')
        throw new Error('A delivery is settling. Try resuming again.');
      if (!acknowledgeDelivery)
        throw new Error('Review the uncertain delivery before resuming without replay.');
      delete project.delivery;
    }
    this.wakes.invalidate(project);
    project.paused = paused;
    if (!paused) delete project.error;
    await this.save();
    this.wakes.kick(project);
  }

  /**
   * The user stopped or closed a conversation by hand. Stopping the main thread
   * holds the whole project; stopping one thread quiets only that thread, so
   * the rest of the project keeps working.
   */
  async userStopped(appSessionId: string): Promise<void> {
    const project = this.membership.get(appSessionId);
    if (!project || this.closed) return;
    if (!this.thread(project, appSessionId).ownerAppSessionId) {
      await this.setPaused(project.id, true);
      return;
    }
    this.wakes.invalidate(project);
    await this.quiet(project, appSessionId);
  }

  async observe(event: ServerEvent): Promise<void> {
    if (this.closed) return;
    await this.turns.observe(event);
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

  sessionAvailable(appSessionId: string): void {
    const project = this.membership.get(appSessionId);
    if (project) this.wakes.available(project, appSessionId);
  }

  capacityChanged(): void {
    this.wakes.capacityChanged(this.projects.values());
  }

  close(): void {
    this.closed = true;
    this.wakes.close();
    this.turns.clear();
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.launches);
    await this.wakes.flush();
    await this.save();
  }

  /** Drops what was queued for a stopped thread once admission has settled. */
  private async quiet(project: Project, target: string): Promise<void> {
    await this.wakes.settle(project);
    clearAsk(project, this.thread(project, target));
    project.pending = project.pending.filter((message) => message.to !== target);
    await this.save();
    this.wakes.kick(project);
  }

  private launch(
    project: Project,
    input: ThreadInput,
    ownerAppSessionId?: string,
  ): Promise<string> {
    const work = this.launchOnce(project, input, ownerAppSessionId);
    this.launches.add(work);
    const release = () => {
      this.launches.delete(work);
    };
    void work.then(release, release);
    return work;
  }

  private async launchOnce(
    project: Project,
    input: ThreadInput,
    ownerAppSessionId?: string,
  ): Promise<string> {
    this.requireOpen();
    this.checkAdmission(project);
    const isCurrent = this.wakes.guard(project);
    let bound: string | undefined;
    project.launching += 1;
    try {
      await this.save();
      if (!isCurrent()) throw new Error('Project launch was cancelled.');
      const brief = ownerAppSessionId ? THREAD_BRIEF : LEAD_BRIEF;
      const session = await this.sessions.create(
        { ...input, prompt: `${brief}\n\nTask:\n${input.prompt}` },
        async (created) => {
          if (!isCurrent()) throw new Error('Project launch was cancelled.');
          if (ownerAppSessionId) this.checkAutonomy(this.requireSession(ownerAppSessionId), input);
          if (this.membership.has(created.appSessionId))
            throw new Error('The harness reused an existing thread identity.');
          bound = created.appSessionId;
          project.threads.push({
            appSessionId: bound,
            ownerAppSessionId,
            title: input.title,
            reply: '',
            waiting: false,
          });
          this.membership.set(bound, project);
          await this.save();
          if (!isCurrent()) throw new Error('Project launch was cancelled.');
        },
      );
      if (!session || !bound)
        throw new Error(
          'The selected harness could not start this thread. Check its session error.',
        );
      return session.appSessionId;
    } catch (error) {
      if (bound) {
        project.threads = project.threads.filter((thread) => thread.appSessionId !== bound);
        this.membership.delete(bound);
      }
      throw error;
    } finally {
      project.launching -= 1;
      await this.save();
    }
  }

  private enqueue(
    project: Project,
    from: string,
    to: string,
    kind: ThreadMessage['kind'],
    text: string,
  ): void {
    this.requireOpen();
    if (!text.trim() || text.length > 8_192)
      throw new Error('Thread messages must contain 1–8192 characters.');
    if (project.pending.length + (project.delivery?.messages.length ?? 0) >= 64)
      throw new Error('Project inbox is full. Review and resume its threads.');
    project.pending.push({ id: randomUUID(), from, to, kind, text });
  }

  private newProject(title: string, id: string = randomUUID()): Project {
    if (this.projects.size >= 32) throw new Error('The local project limit is 32.');
    const project: Project = {
      id,
      title: title.slice(0, 120) || 'Project',
      paused: false,
      launching: 0,
      plan: [],
      threads: [],
      pending: [],
    };
    this.projects.set(project.id, project);
    return project;
  }

  private controlledProject(source: string, target: string): Project {
    this.requireOpen();
    const project = this.requireProjectFor(source);
    const actor = this.thread(project, source);
    const thread = this.thread(project, target);
    if (source === target || (actor.ownerAppSessionId && thread.ownerAppSessionId !== source))
      throw new Error('Only the main thread or a direct owner can control this thread.');
    return project;
  }

  private requireProjectFor(source: string): Project {
    const project = this.membership.get(source);
    if (!project) throw new Error('This chat has not spawned a project thread.');
    return project;
  }

  private thread(project: Project, appSessionId: string): ProjectThread {
    return requireThread(project, appSessionId);
  }

  private requireSession(appSessionId: string): SessionSummary {
    const session = this.sessions.get(appSessionId);
    if (!session) throw new Error('Session is no longer available.');
    return session;
  }

  private checkAutonomy(owner: SessionSummary, input: ThreadInput): void {
    if (autonomy.indexOf(input.autonomy) > autonomy.indexOf(owner.autonomy))
      throw new Error('A spawned thread cannot exceed its owner’s autonomy.');
  }

  /** Whether this project can take another thread at all. */
  private checkAdmission(project: Project): void {
    if (project.paused) throw new Error('Resume project coordination before spawning a thread.');
    if (project.threads.length + project.launching >= 8)
      throw new Error('A project supports at most eight threads.');
  }

  private requireOpen(): void {
    if (this.closed) throw new Error('Projects are shutting down.');
  }

  private fail(project: Project, error: unknown): void {
    this.wakes.invalidate(project);
    project.paused = true;
    project.error = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    if (project.delivery) project.delivery.state = 'uncertain';
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }

  private async save(): Promise<void> {
    try {
      await this.store.save([...this.projects.values()]);
    } catch (error) {
      for (const project of this.projects.values()) this.fail(project, error);
      throw error;
    }
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }
}
