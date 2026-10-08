import { hasUndeliveredReport } from './projectInbox.js';
import type { ProjectPort } from './sessions.js';
import type { ProjectWakeQueue } from './ProjectWakeQueue.js';
import type {
  Project,
  ProjectThread,
  ProjectTodo,
  ProjectView,
  RuntimeLoad,
  ThreadWait,
} from './types.js';
import {
  requireThread,
  scopedThreads,
  threadState,
  threadWaitReason,
  type ThreadState,
} from './projectTurns.js';
import { latestSettledReply } from './activity.js';
import { LEDGER_LIMITS } from './store.js';

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
  /** Identity of the latest reply observed by this read. */
  replyId?: string;
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

/** Reads the project graph and transcripts without opening or changing a runtime. */
export class ProjectReads {
  constructor(
    private readonly sessions: ProjectPort,
    private readonly wakes: ProjectWakeQueue,
  ) {}

  view(project: Project): ProjectView {
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

  /**
   * The whole of a thread, for the chat that owns it: what it replied, the
   * question it is waiting on, and what it is running as. A report carries an
   * excerpt, so this is how a lead reads the rest or looks again later. It asks
   * for how far back it wants to read: one answer by default, never the lot.
   */
  async readFull(
    project: Project,
    target: string,
    isCurrent: () => boolean,
  ): Promise<ThreadReadout> {
    const read = this.read(project, target);
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
      if (
        !isCurrent() ||
        requireThread(project, read.threadId) !== thread ||
        thread.reply !== reply ||
        thread.replyId !== read.replyId ||
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
        (event) => event.role === 'primary' && event.author === 'user' && !event.steered,
      ).length;
      complete = events.length < limit || (fullReply.length > 0 && prompts >= (running ? 2 : 1));
      limit *= 2;
    }
    return { ...read, replies: fullReply ? [fullReply] : [], moreReplies: 0, note: undefined };
  }

  read(project: Project, target: string, replies = 1): ThreadReadout {
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
      ...(thread.replyId ? { replyId: thread.replyId } : {}),
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

  listThreads(project: Project, source: string, all = false) {
    const caller = requireThread(project, source);
    let omitted = 0;
    const threads = scopedThreads(project, source).flatMap((thread) => {
      const status = this.threadStatus(project, thread);
      const queued = this.queuedMessages(project, thread.appSessionId);
      if (
        !all &&
        (status.state === 'idle' || status.state === 'stopped') &&
        !thread.unread &&
        !hasUndeliveredReport(project, thread.appSessionId) &&
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
  projectRead(project: Project, source: string) {
    const threads = this.listThreads(project, source);
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

  openTodos(project: Project): Omit<ProjectTodo, 'notified'>[] {
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

  threadStatus(project: Project, thread: ProjectThread) {
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
}

/** Clears the unread flag of precisely the reply the caller observed, and saves it. */
export async function acknowledgeReply(
  thread: ProjectThread,
  replyId: string | undefined,
  persist: () => Promise<void>,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (!thread.unread || thread.replyId !== replyId) return false;
  // Cleared before the save, so a save running alongside cannot write it back.
  delete thread.unread;
  try {
    await persist();
  } catch (error) {
    if (thread.replyId === replyId) thread.unread = true;
    throw error;
  }
  return isCurrent();
}
