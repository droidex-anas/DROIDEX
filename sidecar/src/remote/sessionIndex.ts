import { resolve } from 'node:path';
import type { ClientCommand, PermissionRequest, ServerEvent, SessionQuestion, SessionSummary } from '../protocol.js';

// Read-only projection of the desktop's canonical events; never owns agent runtimes.
export class RemoteSessionIndex {
  private summaries = new Map<string, SessionSummary>();
  private permissions = new Map<string, PermissionRequest>();
  private questions = new Map<string, SessionQuestion>();
  private live = new Set<string>();

  observe(event: ServerEvent): void {
    if (event.type === 'sessions.list') {
      // Desktop lists may be filtered to another workspace. Absence is not deletion.
      for (const summary of event.sessions) {
        if (!this.live.has(summary.appSessionId)) this.summaries.set(summary.appSessionId, summary);
      }
    } else if (event.type === 'session.created' || event.type === 'session.updated') {
      this.summaries.set(event.session.appSessionId, event.session);
      if (event.type === 'session.created' || event.session.streaming) this.live.add(event.session.appSessionId);
      if (!event.session.streaming && !['awaiting_plan_approval', 'awaiting_run_start'].includes(event.session.phase)) {
        this.permissions.delete(event.session.appSessionId);
        this.questions.delete(event.session.appSessionId);
      }
    } else if (event.type === 'approval.requested') {
      this.permissions.set(event.request.appSessionId, event.request);
    } else if (event.type === 'question.requested') {
      this.questions.set(event.question.appSessionId, event.question);
    } else if (event.type === 'session.closed') {
      this.live.delete(event.appSessionId);
      this.permissions.delete(event.appSessionId);
      this.questions.delete(event.appSessionId);
      const summary = this.summaries.get(event.appSessionId);
      if (summary) this.summaries.set(event.appSessionId, { ...summary, streaming: false, phase: 'paused' });
    }
  }

  commandCompleted(command: ClientCommand): void {
    if (command.type === 'approval.respond' && this.permissions.get(command.appSessionId)?.requestId === command.requestId) {
      this.permissions.delete(command.appSessionId);
    }
    if (command.type === 'question.respond' && this.questions.get(command.appSessionId)?.requestId === command.requestId) {
      this.questions.delete(command.appSessionId);
    }
  }

  recent(workspace: string, limit = 5): SessionSummary[] {
    const root = resolve(workspace);
    return [...this.summaries.values()]
      .filter((row) => row.cwd && resolve(row.cwd) === root && row.sessionPurpose !== 'mission-control')
      .sort((a, b) => b.updatedAt - a.updatedAt || a.appSessionId.localeCompare(b.appSessionId))
      .slice(0, limit);
  }

  summary(id: string): SessionSummary | undefined { return this.summaries.get(id); }
  permission(id: string): PermissionRequest | undefined { return this.permissions.get(id); }
  question(id: string): SessionQuestion | undefined { return this.questions.get(id); }
  isLive(id: string): boolean { return this.live.has(id); }
}
