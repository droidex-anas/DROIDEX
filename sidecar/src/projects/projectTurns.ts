import { ProjectActivity, type ThreadTurn } from './activity.js';
import type { ProjectWakeQueue } from './ProjectWakeQueue.js';
import { failureReport, inboxFull, questionText } from './projectMessages.js';
import type { ServerEvent, SessionQuestion, SessionSummary } from '../protocol.js';
import { randomUUID } from 'node:crypto';
import { LEDGER_LIMITS } from './store.js';
import type { Project, ProjectThread, RuntimeLoad, ThreadMessage, ThreadWait } from './types.js';

export type ThreadState =
  | 'working'
  | 'queued'
  | 'waiting'
  | 'approval'
  | 'rate-limited'
  | 'stopped'
  | 'failed'
  | 'idle';

/* A project runs as many threads as its work needs, so the ledger cannot keep
   every thread's history. The settled threads whose conversations moved most
   recently keep their earlier replies for thread_read; an older one keeps only
   its final reply. Its whole conversation stays in its own transcript. */
const THREADS_KEEPING_EARLIER_REPLIES = 8;

interface ProjectTurnsDependencies {
  /** The project a conversation belongs to, if it belongs to one. */
  project: (appSessionId: string) => Project | undefined;
  session: (appSessionId: string) => SessionSummary | undefined;
  /** Whether the question a thread was routed from is still waiting. */
  isAsking: (appSessionId: string, requestId: string) => boolean;
  enqueue: (project: Project, message: Omit<ThreadMessage, 'id'>) => void;
  /** Queues a thread's report to its owner, or keeps it on the thread while the inbox is full. */
  report: (
    project: Project,
    thread: ProjectThread,
    text: string,
    replyId?: string,
    leadAlert?: boolean,
  ) => void;
  leadFailed: (project: Project) => void;
  leadRecovered: (project: Project) => void;
  teamIdle: (project: Project) => void;
  save: () => Promise<void>;
  fail: (project: Project, error: unknown) => void;
  wakes: ProjectWakeQueue;
}

/**
 * What a thread's turn does to its project: what it replied, the question it
 * stopped on, and the wake its owner gets for either. The graph and the tools
 * that act on it live in ProjectService; this owns only the reading of a turn.
 */
export class ProjectTurns {
  private readonly activity = new ProjectActivity();

  constructor(private readonly d: ProjectTurnsDependencies) {}

  async observe(event: ServerEvent): Promise<void> {
    if (event.type === 'event.appended') {
      if (this.d.project(event.event.appSessionId)) this.activity.append(event.event);
      return;
    }
    if (event.type === 'question.requested') {
      await this.routeQuestion(event.question);
      return;
    }
    if (event.type === 'interaction.cancelled') {
      await this.dropRoutedQuestion(event.appSessionId, event.requestId);
      return;
    }
    if (event.type === 'session.closed') {
      this.activity.finish(event.appSessionId);
      await this.forgetAsk(event.appSessionId);
      return;
    }
    if (event.type !== 'session.updated' && event.type !== 'session.created') return;
    await this.settle(event.session);
  }

  clear(): void {
    this.activity.clear();
  }

  turnCount(appSessionId: string): number {
    return this.activity.turnCounts.get(appSessionId) ?? 0;
  }

  private async settle(session: SessionSummary): Promise<void> {
    const project = this.d.project(session.appSessionId);
    if (!project) return;
    const thread = requireThread(project, session.appSessionId);
    if (session.streaming) {
      const opened = this.activity.open(session.appSessionId);
      const started = thread.queuedSpawn !== undefined || thread.stopped === true;
      delete thread.queuedSpawn;
      delete thread.stopped;
      // A question answered in the thread itself settles without an event, and
      // the turn carries on: checking it here is what lets the answer given
      // first win, instead of the owner being told to answer it all turn.
      const settled = thread.ask && !this.d.isAsking(thread.appSessionId, thread.ask.requestId);
      const cleared = (opened || settled) && clearAsk(project, thread);
      if (started || cleared) {
        await this.d.save();
        this.d.wakes.kick(project);
      }
      return;
    }
    const turn = this.activity.finish(session.appSessionId);
    this.d.wakes.available(project, session.appSessionId);
    // Nothing was open, so this update settled nothing: a title, a token count,
    // or the tail of a turn already reported.
    if (!turn) {
      this.d.wakes.kick(project);
      return;
    }
    const replyId = this.keepReply(project, thread, turn.text);
    if (turn.error) thread.error = turn.error;
    else delete thread.error;
    // A question the turn ended on will never be answered now.
    clearAsk(project, thread);
    if (!thread.ownerAppSessionId) {
      if (session.phase === 'failed') this.d.leadFailed(project);
      else if (session.phase !== 'paused') this.d.leadRecovered(project);
    } else {
      try {
        // The wake already names the thread; this is how its turn ended.
        this.d.report(
          project,
          thread,
          threadReport(thread.title, session, turn),
          replyId,
          session.phase === 'failed' || session.usageLimit !== undefined,
        );
        this.d.teamIdle(project);
      } catch (error) {
        this.d.fail(project, error);
      }
    }
    await this.d.save();
    this.d.wakes.kick(project);
  }

  /* Only a thread's owner reads its replies back. The lead's go to the user,
     and nothing reads them from the ledger. A turn that says nothing must not
     erase what the thread last said. */
  private keepReply(project: Project, thread: ProjectThread, text: string): string | undefined {
    if (!text || !thread.ownerAppSessionId) return;
    if (thread.reply) {
      thread.earlierReplies = [...(thread.earlierReplies ?? []), thread.reply].slice(
        -LEDGER_LIMITS.earlierReplies,
      );
      this.forgetOlderReplies(project);
    }
    thread.reply = text;
    thread.replyId = randomUUID();
    thread.unread = true;
    delete thread.repliesShed;
    return thread.replyId;
  }

  private forgetOlderReplies(project: Project): void {
    const settled = project.threads
      .map((thread) => ({ thread, session: this.d.session(thread.appSessionId) }))
      .filter(({ thread, session }) => thread.earlierReplies && !session?.streaming)
      .sort((a, b) => (b.session?.updatedAt ?? 0) - (a.session?.updatedAt ?? 0));
    for (const { thread } of settled.slice(THREADS_KEEPING_EARLIER_REPLIES))
      delete thread.earlierReplies;
  }

  /*
   * A thread that asks its harness's own question would otherwise sit there
   * until a human noticed. Its owner is the conversation that gave it the task,
   * so the question goes there with its options intact; the human can still
   * answer it in the thread, and whoever answers first wins.
   */
  private async routeQuestion(question: SessionQuestion): Promise<void> {
    const project = this.d.project(question.appSessionId);
    if (!project) return;
    const thread = project.threads.find(
      (candidate) => candidate.appSessionId === question.appSessionId,
    );
    if (!thread?.ownerAppSessionId) return;
    // A harness writes this, so it is bounded here rather than trusted: the
    // ledger's own limits are enforced when it loads, and a question stored
    // past them would refuse to load the whole file on the next start.
    const questions = question.questions.slice(0, LEDGER_LIMITS.askQuestions).map((item) => ({
      index: Math.min(Math.max(Math.trunc(item.index), 0), LEDGER_LIMITS.askIndex),
      question: item.question.slice(0, LEDGER_LIMITS.askQuestionText),
      options: item.options
        .slice(0, LEDGER_LIMITS.askOptions)
        .map((option) => option.label.slice(0, LEDGER_LIMITS.askOptionText)),
    }));
    if (!questions.length) return;
    const ask = { requestId: question.requestId, questions };
    // A full inbox leaves this question unnotified for the existing refill path.
    thread.ask = ask;
    thread.waiting = true;
    try {
      // The id travels with the question, so an answer written for it can
      // never settle a later question the thread asks instead.
      if (!inboxFull(project)) {
        this.d.enqueue(project, {
          from: thread.appSessionId,
          to: thread.ownerAppSessionId,
          kind: 'question',
          text: questionText(ask),
          questionId: question.requestId,
        });
        thread.ask.notified = true;
      }
    } catch (error) {
      // Holding a project is a decision the ledger has to carry: without this
      // the hold and its reason live only in memory until something else saves.
      this.d.fail(project, error);
      await this.d.save();
      return;
    }
    await this.d.save();
    this.d.wakes.kick(project);
  }

  /** The question died with the turn that raised it, so nobody can answer it. */
  private async dropRoutedQuestion(appSessionId: string, requestId: string): Promise<void> {
    const project = this.d.project(appSessionId);
    const thread = project?.threads.find((candidate) => candidate.appSessionId === appSessionId);
    if (!project || thread?.ask?.requestId !== requestId) return;
    clearAsk(project, thread);
    await this.d.save();
    // Its message may have left the inbox, which is room for a report owed.
    this.d.wakes.kick(project);
  }

  /** Whatever the thread was waiting on, it is not waiting any more. */
  private async forgetAsk(appSessionId: string): Promise<void> {
    const project = this.d.project(appSessionId);
    const thread = project?.threads.find((candidate) => candidate.appSessionId === appSessionId);
    if (!project || !thread || !clearAsk(project, thread)) return;
    await this.d.save();
    this.d.wakes.kick(project);
  }
}

export function requireThread(project: Project, appSessionId: string): ProjectThread {
  const thread = project.threads.find((item) => item.appSessionId === appSessionId);
  if (!thread) throw new Error('Thread is outside this project.');
  return thread;
}

export function scopedThreads(project: Project, source: string): ProjectThread[] {
  const caller = requireThread(project, source);
  return project.threads.filter(
    (thread) =>
      thread.appSessionId !== source &&
      (!caller.ownerAppSessionId || thread.ownerAppSessionId === source),
  );
}

export function resolveThreadId(project: Project, source: string, id: string): string {
  // An exact identity takes precedence over prefix matching.
  if (project.threads.some((thread) => thread.appSessionId === id)) return id;
  if (id.length < 8)
    throw new Error('Use a full thread id or a unique prefix of at least 8 characters.');
  const matches = scopedThreads(project, source).filter((thread) =>
    thread.appSessionId.startsWith(id),
  );
  if (matches.length === 1) return matches[0].appSessionId;
  if (matches.length > 1)
    throw new Error(
      `Ambiguous thread prefix "${id}": ${matches.map((thread) => `${thread.title} (${thread.appSessionId})`).join(', ')}. Use a longer prefix or the full id.`,
    );
  throw new Error('Thread is outside this project or your ownership scope.');
}

export function threadWaitReason(
  state: ThreadState,
  wait: ThreadWait | undefined,
  load: RuntimeLoad,
  paused: boolean,
  queued: number,
): string | undefined {
  if (wait?.kind === 'start')
    return `queued to start · ${ordinal(wait.position)}${paused ? ' · project held' : ''}`;
  if (paused) return 'project held · waits for the user to resume it';
  if (wait?.kind === 'slot')
    return `waiting for a free slot · ${ordinal(wait.position)} in line (${String(load.live)} running, limit ${String(load.limit)})`;
  if (wait?.kind === 'turn') return 'message waits for its turn to end';
  if (queued)
    return state === 'working'
      ? 'message waits for its turn to end'
      : 'message queued for delivery';
  if (state === 'waiting') return 'waiting for an answer';
  if (state === 'stopped') return 'stopped · thread_send continues it';
  if (state === 'failed') return 'last turn failed';
  if (state === 'idle') return 'no turn running';
  return undefined;
}

function ordinal(position: number): string {
  const lastTwo = position % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${String(position)}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][position % 10] ?? 'th';
  return `${String(position)}${suffix}`;
}

/** Takes a thread out of its project with every message to or from it, so the ledger never names it. */
export function removeThread(project: Project, thread: ProjectThread): void {
  const unrelated = (message: ThreadMessage) =>
    message.from !== thread.appSessionId && message.to !== thread.appSessionId;
  project.threads = project.threads.filter((candidate) => candidate !== thread);
  project.pending = project.pending.filter(unrelated);
  if (project.delivery) {
    project.delivery.messages = project.delivery.messages.filter(unrelated);
    if (!project.delivery.messages.length) delete project.delivery;
  }
}

/**
 * Leaves a thread with no question outstanding, and takes the wake that carried
 * it off the queue: an owner woken to answer a question its thread no longer
 * holds would send the answer to a thread waiting for nothing.
 */
export function clearAsk(project: Project, thread: ProjectThread): boolean {
  if (!thread.ask && !thread.waiting) return false;
  delete thread.ask;
  thread.waiting = false;
  project.pending = project.pending.filter(
    (message) => message.kind !== 'question' || message.from !== thread.appSessionId,
  );
  return true;
}

/* The live state of a thread, owned by its session rather than copied here. A
   question outlives no turn, so an outstanding one is what it is waiting on,
   even while the turn that asked it is still streaming. */
export function threadState(
  thread: ProjectThread,
  session: SessionSummary | undefined,
  wait?: ThreadWait,
): ThreadState {
  if (thread.queuedSpawn?.phase === 'failed') return 'failed';
  if (thread.queuedSpawn) return 'queued';
  if (wait?.kind === 'slot') return 'waiting';
  if (thread.ask) return 'waiting';
  if (!session?.streaming && session?.usageLimit) return 'rate-limited';
  if (session?.streaming) return 'working';
  if (session?.phase === 'failed') return 'failed';
  if (session?.phase === 'paused') return 'stopped';
  return 'idle';
}

/* What the owner is told when a thread's turn ends. A thread that answered
   nothing says so plainly: the owner has to see the difference between a report
   and silence, or it will keep nudging a thread that cannot answer. A long reply
   is excerpted here and read in full with thread_read, so the excerpt says it is
   one, in words that read the same to the person watching this chat. */
function threadReport(title: string, session: SessionSummary, turn: ThreadTurn): string {
  const reply = turn.text.slice(0, 1_200);
  const excerpt =
    reply.length < turn.text.length
      ? `The first 1,200 characters of a longer reply (truncated; read the full reply with thread_read full: true):\n${reply}`
      : reply;
  if (session.phase === 'failed' || session.usageLimit) {
    const reason =
      turn.error ??
      (session.usageLimit ? 'Provider usage limit reached' : 'The turn ended without completing');
    return [failureReport(title, reason, session.usageLimit?.resetsAt), excerpt]
      .filter(Boolean)
      .join('\n');
  }
  if (session.phase === 'paused')
    return ['It was stopped before it finished.', excerpt].filter(Boolean).join('\n');
  return excerpt || 'It ended its turn without a reply.';
}
