import { ProjectActivity, type ThreadTurn } from './activity.js';
import type { ProjectWakeQueue } from './ProjectWakeQueue.js';
import type { ServerEvent, SessionQuestion, SessionSummary } from '../protocol.js';
import { LEDGER_LIMITS } from './store.js';
import type { Project, ProjectThread, ThreadMessage } from './types.js';

export type ThreadState = 'working' | 'waiting' | 'stopped' | 'failed' | 'idle';

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
  enqueue: (
    project: Project,
    from: string,
    to: string,
    kind: ThreadMessage['kind'],
    text: string,
  ) => void;
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

  private async settle(session: SessionSummary): Promise<void> {
    const project = this.d.project(session.appSessionId);
    if (!project) return;
    const thread = requireThread(project, session.appSessionId);
    if (session.streaming) {
      const opened = this.activity.open(session.appSessionId);
      // A question answered in the thread itself settles without an event, and
      // the turn carries on: checking it here is what lets the answer given
      // first win, instead of the owner being told to answer it all turn.
      const settled = thread.ask && !this.d.isAsking(thread.appSessionId, thread.ask.requestId);
      if ((opened || settled) && clearAsk(project, thread)) {
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
    this.keepReply(project, thread, turn.text);
    if (turn.error) thread.error = turn.error;
    else delete thread.error;
    // A question the turn ended on will never be answered now.
    clearAsk(project, thread);
    if (!thread.ownerAppSessionId) {
      if (session.phase === 'failed')
        this.d.fail(
          project,
          new Error('The main thread failed. Review its error before resuming coordination.'),
        );
    } else {
      try {
        // The wake already names the thread; this is how its turn ended.
        this.d.enqueue(
          project,
          thread.appSessionId,
          thread.ownerAppSessionId,
          'result',
          threadReport(session, turn),
        );
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
  private keepReply(project: Project, thread: ProjectThread, text: string): void {
    if (!text || !thread.ownerAppSessionId) return;
    if (thread.reply) {
      thread.earlierReplies = [...(thread.earlierReplies ?? []), thread.reply].slice(
        -LEDGER_LIMITS.earlierReplies,
      );
      this.forgetOlderReplies(project);
    }
    thread.reply = text;
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
    if (!project || project.paused) return;
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
        .map((option) => option.slice(0, LEDGER_LIMITS.askOptionText)),
    }));
    if (!questions.length) return;
    const asked = questions
      .map((item) =>
        item.options.length
          ? `${item.question}\n${item.options.map((option) => `- ${option}`).join('\n')}`
          : item.question,
      )
      .join('\n\n')
      .slice(0, LEDGER_LIMITS.text);
    try {
      this.d.enqueue(project, thread.appSessionId, thread.ownerAppSessionId, 'question', asked);
    } catch (error) {
      // Holding a project is a decision the ledger has to carry: without this
      // the hold and its reason live only in memory until something else saves.
      this.d.fail(project, error);
      await this.d.save();
      return;
    }
    thread.ask = { requestId: question.requestId, questions };
    thread.waiting = true;
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
): ThreadState {
  if (thread.ask) return 'waiting';
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
function threadReport(session: SessionSummary, turn: ThreadTurn): string {
  const reply = turn.text.slice(-1_200);
  const excerpt =
    reply.length < turn.text.length
      ? `The last 1,200 characters of a longer reply:\n${reply}`
      : reply;
  if (session.phase === 'failed')
    return ['It failed before finishing.', turn.error, excerpt].filter(Boolean).join('\n');
  if (session.phase === 'paused')
    return ['It was stopped before it finished.', excerpt].filter(Boolean).join('\n');
  return excerpt || 'It ended its turn without a reply.';
}
