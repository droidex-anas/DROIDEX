import type { AutomationDeliveryReceipt } from '../automations/types.js';
import { ProjectWakeQueue } from './ProjectWakeQueue.js';
import {
  clearAsk,
  ProjectTurns,
  requireThread,
  threadState,
  type ThreadState,
} from './projectTurns.js';
import { randomUUID } from 'node:crypto';
import type { ProviderStatus, ServerEvent, SessionSummary } from '../protocol.js';
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

/** What a spawn reports back to the chat that made it. */
interface StartedThread {
  appSessionId: string;
  title: string;
  cwd?: string;
  branch?: string;
  step?: string;
}

/** What a chat reads back about a thread it owns. */
export interface ThreadReadout {
  threadId: string;
  title: string;
  state: ThreadState;
  /** The replies asked for, oldest first; the latest one alone by default. */
  replies: string[];
  /** Older replies DROIDEX still holds, for an owner that wants more context. */
  moreReplies: number;
  /** Why replies is empty when the thread did reply. */
  note?: string;
  error?: string;
  question?: { index: number; question: string; options: string[] }[];
  cwd?: string;
  modelId?: string;
  reasoningEffort?: string;
  autonomy?: string;
}

export class ProjectService {
  private readonly projects = new Map<string, Project>();
  private readonly membership = new Map<string, Project>();
  /* The project a chat builds with its first spawn or plan, keyed by that chat.
     It joins the ledger when a thread binds to it or the chat writes a plan,
     and leaves this map once no spawn for it is still starting: kept when it
     holds a thread or a plan, forgotten when it holds nothing, so a spawn that
     fails leaves no project behind. */
  private readonly adopting = new Map<string, Project>();
  private readonly launches = new Set<Promise<string>>();
  /** The folder each thread still starting will share or join; memory only, as a restart starts none. */
  private readonly checkoutClaims = new Set<CheckoutClaim>();
  /** Spawns under way, by the chat that asked, so the user's Stop on that chat cancels them. */
  private readonly spawnsUnderWay = new Set<{ source: string; stopped: boolean }>();
  private readonly wakes: ProjectWakeQueue;
  private readonly turns: ProjectTurns;
  private readonly chats: SpawnedChats;
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
      session: (appSessionId) => sessions.get(appSessionId),
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
      // Only a delivery caught mid-flight is uncertain, and only that needs a
      // person to look before coordination goes on. Holding every project over
      // a restart stopped them all silently: a thread would answer, its report
      // would queue, and the lead would never be woken for it.
      if (project.delivery) {
        project.delivery.state = 'uncertain';
        project.paused = true;
        delete project.leadStopped;
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
    const project = this.blankProject(input.title, requestId);
    this.projects.set(project.id, project);
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

  async spawn(source: string, requested: ThreadSpawnInput): Promise<StartedThread> {
    this.requireOpen();
    const owner = this.requireSession(source);
    if (owner.sessionPurpose !== 'chat')
      throw new Error('Only ordinary chats can own project threads.');
    const underWay = { source, stopped: false };
    this.spawnsUnderWay.add(underWay);
    let input: Omit<ThreadInput, 'cwd'>;
    try {
      await this.resumeAfterLeadStop(source);
      input = await spawnSettings(owner, requested, () => this.sessions.catalog());
    } finally {
      this.spawnsUnderWay.delete(underWay);
    }
    // A chat's first spawn has no project yet for a Stop to hold, so one that
    // came while the settings resolved is only known here.
    if (underWay.stopped) throw new Error('Project launch was cancelled.');
    const joined = this.membership.get(source);
    if (!joined && requested.step)
      throw new Error('This chat keeps no plan yet. Call plan_set first, or spawn without step.');
    if (!joined && requested.workspaceOf)
      throw new Error('This chat has started no threads to share a checkout with.');
    const project = joined ?? this.adoption(source, owner);
    try {
      return await this.startThread(project, source, owner, input, requested);
    } finally {
      if (this.settleAdoption(project)) await this.save();
    }
  }

  /** A spawn with reportBack false: an ordinary sidebar chat, outside every project. */
  async startChat(source: string, requested: ThreadSpawnInput): Promise<StartedChat> {
    this.requireOpen();
    const project = this.membership.get(source);
    if (project && requireThread(project, source).ownerAppSessionId)
      throw new Error("A thread's spawns always report back to it. Pass reportBack true.");
    const underWay = { source, stopped: false };
    this.spawnsUnderWay.add(underWay);
    try {
      return await this.chats.start(source, requested, () => underWay.stopped);
    } finally {
      this.spawnsUnderWay.delete(underWay);
    }
  }

  /** Admits, checks out and launches one thread of a project, and links the step it carries. */
  private async startThread(
    project: Project,
    source: string,
    owner: SessionSummary,
    input: Omit<ThreadInput, 'cwd'>,
    requested: ThreadSpawnInput,
  ): Promise<StartedThread> {
    let ancestor: string | undefined = source;
    let depth = 0;
    while (ancestor) {
      depth += 1;
      ancestor = requireThread(project, ancestor).ownerAppSessionId;
    }
    if (depth >= 4) throw new Error('Project thread nesting is limited to three levels.');
    // Everything a spawn can be refused for is checked before its checkout is
    // cut, because a worktree for a thread that never starts is left on disk
    // with nothing to say it was ours: a bad step name or a held project would
    // each strand one.
    this.checkAdmission(project);
    const named = requested.step ? findPlanStep(project.plan, requested.step) : undefined;
    // The thread counts as starting while its checkout is cut, and the count is
    // handed to the launch without a gap.
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
    const prompt = threadPrompt(input.prompt, workspace);
    const title = uniqueTitle(project, input.title);
    let appSessionId: string;
    try {
      appSessionId = await this.launch(project, { ...input, title, prompt, cwd }, source);
    } catch (error) {
      if (workspace) await discardThreadCheckout(owner.cwd, workspace);
      throw error;
    } finally {
      // A launch returns once the thread's first turn is running, so from here
      // its session's own streaming flag says it works in that folder.
      this.checkoutClaims.delete(claim);
    }
    // The step resolved before the launch, unless plan_set replaced the plan
    // while the thread started; then the new step with its title.
    const step =
      named && !project.plan.includes(named)
        ? project.plan.find((candidate) => candidate.title === named.title)
        : named;
    if (step) {
      step.threadAppSessionId = appSessionId;
      delete step.state;
      await this.save();
    }
    return {
      appSessionId,
      title,
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
  async setPlan(source: string, steps: readonly Omit<ProjectStep, 'id'>[]): Promise<number> {
    this.requireOpen();
    if (steps.length > LEDGER_LIMITS.planSteps)
      throw new Error(`A project plan holds at most ${String(LEDGER_LIMITS.planSteps)} steps.`);
    let project = this.membership.get(source);
    if (project && requireThread(project, source).ownerAppSessionId)
      throw new Error('Only the chat that leads a project keeps its plan.');
    if (!project) {
      // With no project there is no plan to clear.
      if (!steps.length) return 0;
      const owner = this.requireSession(source);
      if (owner.sessionPurpose !== 'chat')
        throw new Error('Only ordinary chats can keep a project plan.');
      if (steps.some((step) => step.threadAppSessionId))
        throw new Error('This chat has started no threads yet; leave threadId out.');
      project = this.adoption(source, owner);
      this.commitAdoption(source, project);
    }
    const members = new Set(project.threads.map((thread) => thread.appSessionId));
    project.plan = planFromSteps(steps, (id) => members.has(id));
    this.settleAdoption(project);
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
    const thread = requireThread(project, target);
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
   * for how far back it wants to read: one answer by default, never the lot.
   */
  read(source: string, target: string, replies = 1): ThreadReadout {
    const project = this.controlledProject(source, target);
    const thread = requireThread(project, target);
    const session = this.sessions.get(target);
    const kept = thread.reply ? [...(thread.earlierReplies ?? []), thread.reply] : [];
    const wanted = Math.min(Math.max(replies, 1), LEDGER_LIMITS.earlierReplies + 1);
    return {
      threadId: target,
      title: thread.title,
      state: threadState(thread, session),
      replies: kept.slice(-wanted),
      moreReplies: Math.max(kept.length - wanted, 0),
      ...(thread.repliesShed
        ? {
            note: 'DROIDEX dropped its replies to keep the project ledger small. Its whole conversation stays in its own transcript, which the user can open.',
          }
        : {}),
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

  /** Retunes a thread within the limits of the chat that started it, and reads back what took. */
  async configure(
    source: string,
    target: string,
    settings: ThreadSettings,
  ): Promise<ThreadReadout> {
    const project = this.controlledProject(source, target);
    const caller = this.requireSession(source);
    const session = this.requireSession(target);
    const modelId = settings.modelId
      ? resolveModelId(await this.sessions.catalog(), caller, session.provider, settings.modelId)
      : undefined;
    // A lead can retune a thread its own thread started, and that thread is the
    // ceiling, not the lead.
    const owner = requireThread(project, target).ownerAppSessionId ?? source;
    if (settings.autonomy) checkWithinAutonomy(this.requireSession(owner), settings.autonomy);
    await this.sessions.configure(target, {
      ...(modelId ? { modelId } : {}),
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
    delete project.leadStopped;
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
    for (const spawn of this.spawnsUnderWay)
      if (spawn.source === appSessionId) spawn.stopped = true;
    // A chat's first project is still being adopted until its thread binds,
    // and a Stop then has to cancel that spawn like any other.
    const project = this.membership.get(appSessionId) ?? this.adopting.get(appSessionId);
    if (!project || this.closed) return;
    if (!requireThread(project, appSessionId).ownerAppSessionId) {
      // A hold already in place for another reason stays the user's to lift.
      if (!project.paused) project.leadStopped = true;
      this.wakes.invalidate(project);
      project.paused = true;
      await this.save();
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

  /** Session history knows every thread now, so what a restart left queued can go out. */
  historyReady(): void {
    this.wakes.start(this.projects.values());
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

  /**
   * The user's Stop on a project's main chat holds the project, and that chat's
   * own next spawn resumes it the way Resume in Projects does: the chat is
   * working again. A hold from a failure, a loop or an uncertain delivery is
   * never lifted here. This runs as a spawn begins, so a spawn already under
   * way when the user pressed Stop meets the hold and is refused.
   */
  private async resumeAfterLeadStop(source: string): Promise<void> {
    const project = this.membership.get(source);
    if (!project?.leadStopped || project.delivery) return;
    if (requireThread(project, source).ownerAppSessionId) return;
    await this.setPaused(project.id, false);
  }

  /** Drops what was queued for a stopped thread once admission has settled. */
  private async quiet(project: Project, target: string): Promise<void> {
    await this.wakes.settle(project);
    clearAsk(project, requireThread(project, target));
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
          if (ownerAppSessionId)
            checkWithinAutonomy(this.requireSession(ownerAppSessionId), input.autonomy);
          if (this.membership.has(created.appSessionId))
            throw new Error('The harness reused an existing thread identity.');
          if (ownerAppSessionId) this.commitAdoption(ownerAppSessionId, project);
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
        throw new Error('The selected harness did not start this thread and reported no reason.');
      return session.appSessionId;
    } catch (error) {
      if (bound) {
        project.threads = project.threads.filter((thread) => thread.appSessionId !== bound);
        this.membership.delete(bound);
      }
      throw error;
    } finally {
      project.launching -= 1;
      this.settleAdoption(project);
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
    if (!text.trim() || text.length > LEDGER_LIMITS.text)
      throw new Error(
        `Thread messages must contain 1 to ${String(LEDGER_LIMITS.text)} characters.`,
      );
    if (project.pending.length + (project.delivery?.messages.length ?? 0) >= LEDGER_LIMITS.inbox)
      throw new Error(
        `The project inbox is full: ${String(LEDGER_LIMITS.inbox)} messages are waiting for their threads, and nothing more can queue until they are delivered.`,
      );
    project.pending.push({ id: randomUUID(), from, to, kind, text });
  }

  private blankProject(title: string, id: string = randomUUID()): Project {
    return {
      id,
      title: title.slice(0, LEDGER_LIMITS.title) || 'Project',
      paused: false,
      launching: 0,
      plan: [],
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

  /**
   * Once no spawn is still starting a thread for it, an adoption is settled:
   * kept as an ordinary project when it holds a thread or a plan, forgotten
   * when it holds nothing. True when the forgotten one was in the ledger, which
   * the caller then saves without it.
   */
  private settleAdoption(project: Project): boolean {
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    if (!lead || project.launching > 0 || this.adopting.get(lead.appSessionId) !== project)
      return false;
    this.adopting.delete(lead.appSessionId);
    if (project.threads.length > 1 || project.plan.length || !this.projects.has(project.id))
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
    // Only the user's Stop holds a project still being adopted, and Projects
    // does not list it yet, so there is nothing there to resume.
    if (!this.projects.has(project.id)) throw new Error('Project launch was cancelled.');
    throw new Error('This project is held. Ask the user to resume it in Projects first.');
  }

  private requireOpen(): void {
    if (this.closed) throw new Error('Projects are shutting down.');
  }

  private fail(project: Project, error: unknown): void {
    this.wakes.invalidate(project);
    project.paused = true;
    delete project.leadStopped;
    const message = error instanceof Error ? error.message : String(error);
    project.error = message.slice(0, LEDGER_LIMITS.projectError);
    if (project.delivery) project.delivery.state = 'uncertain';
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }

  private async save(): Promise<void> {
    const projects = [...this.projects.values()];
    fitLedger(projects, (appSessionId) => this.sessions.get(appSessionId)?.updatedAt ?? 0);
    try {
      await this.store.save(projects);
    } catch (error) {
      for (const project of this.projects.values()) this.fail(project, error);
      throw error;
    }
    this.emit({ type: 'projects.snapshot', projects: this.list() });
  }
}
