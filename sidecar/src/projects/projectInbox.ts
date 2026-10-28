import { randomUUID } from 'node:crypto';
import { TURN_INTERRUPTED } from '../sessionAdoption.js';
import type { ProjectPort } from './sessions.js';
import { requireThread } from './projectTurns.js';
import { inboxFull, questionText } from './projectMessages.js';
import { LEDGER_LIMITS } from './store.js';
import type { Project, ProjectThread, ThreadMessage } from './types.js';

/** Owns retained messages and the durable intent that fills the inbox after a hold. */
export class ProjectInbox {
  // Identities live in project.interrupted; this set only chooses restart wording.
  private readonly restartRecovery = new Set<string>();
  private readonly approvalNotified = new Map<string, string>();
  private readonly withdrawals = new WeakMap<ProjectThread, object>();
  constructor(
    private readonly sessions: ProjectPort,
    private readonly persist: () => Promise<void>,
    private readonly isOpen: () => boolean,
  ) {}

  forgetRecovery(id: string, project?: Project): boolean {
    this.restartRecovery.delete(id);
    if (!project?.interrupted?.includes(id)) return false;
    project.interrupted = project.interrupted.filter((target) => target !== id);
    if (!project.interrupted.length) delete project.interrupted;
    return true;
  }
  close(): void {
    this.restartRecovery.clear();
    this.approvalNotified.clear();
  }

  refillInterrupted(project: Project): void {
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
      this.forgetRecovery(id, project);
    }
  }

  async recover(projects: Iterable<Project>): Promise<void> {
    const saved = [...projects];
    for (const project of saved) {
      if (!this.isOpen()) continue;
      for (const thread of project.threads) {
        if (!thread.ownerAppSessionId || thread.queuedSpawn || thread.stopped) continue;
        const session = this.sessions.get(thread.appSessionId);
        if (
          session?.interruptReason?.startsWith(TURN_INTERRUPTED) &&
          !session.streaming &&
          session.phase === 'paused'
        ) {
          this.restartRecovery.add(thread.appSessionId);
          project.interrupted = [...new Set([...(project.interrupted ?? []), thread.appSessionId])];
        }
      }
      this.refillInterrupted(project);
      this.teamIdle(project);
    }
    if (
      this.restartRecovery.size ||
      saved.some((project) => project.pending.length || project.wakePending)
    )
      await this.persist();
  }

  /* A report that finds the inbox full waits on its thread and queues as soon as
     a delivery makes room. A newer report from the same thread replaces it. */
  report(
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

  withdraw(project: Project, target: ProjectThread): void {
    this.withdrawals.set(target, {});
    project.pending = project.pending.filter((message) => message.to !== target.appSessionId);
    for (const thread of project.threads) {
      if (thread.ownerAppSessionId !== target.appSessionId) continue;
      delete thread.owedReport;
      if (thread.ask) thread.ask.notified = true;
    }
  }

  /** Only an explicit inbox withdrawal cancels recovery, including after the target continues. */
  refusalRecovery(project: Project, target: string): (messages: ThreadMessage[]) => boolean {
    const thread = requireThread(project, target);
    const withdrawal = this.withdrawals.get(thread);
    return (messages) => {
      if (!this.isOpen() || this.withdrawals.get(thread) !== withdrawal) return false;
      return this.restore(project, messages);
    };
  }

  private restore(project: Project, messages: ThreadMessage[]): boolean {
    for (const message of [...messages].reverse()) {
      if (!inboxFull(project)) {
        project.pending.unshift(message);
        continue;
      }
      const thread = requireThread(project, message.from);
      switch (message.kind) {
        case 'result':
          thread.owedReport ??= { text: message.text, replyId: message.replyId };
          if (message.to !== thread.ownerAppSessionId) thread.owedLeadAlert = true;
          break;
        case 'question':
          if (thread.ask && thread.ask.requestId === message.questionId) delete thread.ask.notified;
          break;
        case 'approval':
          if (this.approvalNotified.get(message.from) === message.approvalId)
            this.approvalNotified.delete(message.from);
          break;
        case 'idle':
          project.wakePending ??= 'team-idle';
          break;
        case 'message': {
          const todo = project.todos.find((todo) => todo.id === message.id);
          if (!todo) throw new Error('A steered inbox instruction must belong to a due to-do.');
          delete todo.notified;
          break;
        }
      }
    }
    return messages.length > 0;
  }

  refill(project: Project): void {
    if (!this.isOpen()) return;
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
    this.refillQuestions(project);
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

  private refillQuestions(project: Project): void {
    for (const thread of project.threads) {
      if (inboxFull(project)) return;
      const ask = thread.ask;
      if (
        !ask ||
        ask.notified ||
        !thread.ownerAppSessionId ||
        !this.sessions.isAsking(thread.appSessionId, ask.requestId)
      )
        continue;
      this.enqueue(project, {
        from: thread.appSessionId,
        to: thread.ownerAppSessionId,
        kind: 'question',
        text: questionText(ask),
        questionId: ask.requestId,
      });
      ask.notified = true;
    }
  }

  refillApprovals(project: Project): void {
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

  teamIdle(project: Project): void {
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

  enqueue(project: Project, message: Omit<ThreadMessage, 'id'>): ThreadMessage {
    if (!this.isOpen()) throw new Error('Projects are shutting down.');
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
    if (message.kind === 'message') this.forgetRecovery(message.to, project);
    return queued;
  }
}

/** The inbox counts what a delivery has claimed, so its limit holds while that delivery is out. */
export function requireMessageText(text: string): void {
  if (!text.trim() || text.length > LEDGER_LIMITS.text)
    throw new Error(`Thread messages must contain 1 to ${String(LEDGER_LIMITS.text)} characters.`);
}

export function hasUndeliveredReport(project: Project, target: string): boolean {
  if (requireThread(project, target).owedReport) return true;
  return [...project.pending, ...(project.delivery?.messages ?? [])].some(
    (message) => message.kind === 'result' && message.from === target,
  );
}
