import { createHash, randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { ClientCommand, ReasoningEffort, ServerEvent, SessionSummary, TranscriptEvent } from '../protocol.js';
import { readWorkspaceDiff } from './diff.js';
import { settleActivity } from './activity.js';
import { RemoteSessionIndex } from './sessionIndex.js';
import { appendTranscript, projectHistory, remoteModels, sessionPhase, trimTranscript } from './sessionProjection.js';
import {
  RemoteError, record, text, uuid,
  type RemoteEvent, type RemoteModel, type RemoteRuntime, type RemoteSelection, type RemoteSession, type RemoteSync,
} from './types.js';

interface SharedSession {
  view: RemoteSession;
  backendId?: string;
  clientRef: string;
  createdByPhone: boolean;
  busy: boolean;
  dispatching: boolean;
  stopRequested: boolean;
  hidden: boolean;
  seen: Set<string>;
  requests: Map<string, string>;
  pendingUserEcho?: string;
  approvalRequestId?: string;
  questionRequestId?: string;
  confirmed?: SessionSummary;
  creating: boolean;
  eventVersion: number;
  historyVersion?: number;
  settledRunId?: string;
  responding?: string;
}

export class RemoteHost {
  models: RemoteModel[] = [];
  sync: RemoteSync = { state: 'loading', message: 'Loading recent desktop sessions' };
  private readonly sessions = new Map<string, SharedSession>();
  private active = true;
  private refresh?: Promise<void>;

  constructor(
    readonly workspace: string,
    private readonly runtime: RemoteRuntime,
    private readonly publish: (event: RemoteEvent) => void,
    private readonly diff = readWorkspaceDiff,
    private readonly index = new RemoteSessionIndex(),
  ) { this.importRecent(); }

  get hasPendingCreates(): boolean { return [...this.sessions.values()].some((row) => row.creating); }
  get sessionCount(): number { return [...this.sessions.values()].filter((row) => !row.hidden).length; }
  get activeCount(): number { return [...this.sessions.values()].filter((row) => !row.hidden && row.view.phase === 'running').length; }

  snapshot(): RemoteSession[] {
    return [...this.sessions.values()].filter((row) => !row.hidden)
      .sort((a, b) => b.view.updatedAt - a.view.updatedAt).map((row) => structuredClone(row.view));
  }

  async refreshCatalog(): Promise<void> {
    this.requireActive();
    await this.runtime.handle({ type: 'catalog.models' });
  }

  refreshRecent(): Promise<void> {
    this.requireActive();
    if (this.refresh) return this.refresh;
    this.sync = { state: 'loading', message: 'Loading recent desktop sessions' };
    this.publish({ type: 'sync', sync: this.sync });
    // Use the existing unfiltered desktop read; a scoped sessions.list would replace
    // the desktop's full inbox with the phone's one-project subset.
    this.refresh = this.runtime.handle({ type: 'sessions.list' }).then(() => {
      if (!this.active) return;
      this.importRecent();
      this.sync = { state: 'ready', message: 'Recent desktop sessions are up to date' };
    }).catch(() => {
      this.sync = { state: 'error', message: 'Recent sessions could not load. Pull to refresh.' };
    }).finally(() => {
      this.refresh = undefined;
      if (this.active) this.publish({ type: 'sync', sync: this.sync });
    });
    return this.refresh;
  }

  observe(event: ServerEvent): void {
    this.index.observe(event);
    if (event.type === 'catalog.updated' && event.catalog === 'models') {
      this.models = remoteModels(event.items);
      if (this.active) this.publish({ type: 'catalog', models: this.models });
      return;
    }
    if (event.type === 'sessions.list') { if (this.active) this.importRecent(); return; }
    if (event.type === 'session.created') {
      const row = [...this.sessions.values()].find((item) => item.clientRef === event.clientRef || item.backendId === event.session.appSessionId);
      if (!row) {
        if (this.active) {
          this.importRecent();
          const imported = [...this.sessions.values()].find((item) => item.backendId === event.session.appSessionId);
          if (imported && event.session.goal && imported.view.messages.length === 0) {
            this.append(imported, { id: `goal:${event.session.appSessionId}`, appSessionId: event.session.appSessionId,
              sourceSessionId: 'user', role: 'primary', kind: 'text', author: 'user', text: event.session.goal, ts: event.session.createdAt });
          }
        }
        return;
      }
      row.creating = false;
      row.backendId = event.session.appSessionId;
      if (!this.active || row.hidden || row.stopRequested) {
        if (row.createdByPhone) void this.runtime.handle({ type: 'session.close', appSessionId: row.backendId })
          .then(() => { row.busy = false; }, () => { this.fail(row, 'Could not close a cancelled mobile session. Check the desktop.'); });
      } else this.updateSummary(row, event.session);
      return;
    }
    if (event.type === 'error' && event.clientRef) {
      const row = [...this.sessions.values()].find((item) => item.clientRef === event.clientRef);
      if (row) { row.creating = false; this.fail(row, event.message); }
      return;
    }
    const backendId = event.type === 'event.appended' ? event.event.appSessionId
      : event.type === 'session.updated' ? event.session.appSessionId
      : event.type === 'approval.requested' ? event.request.appSessionId
      : event.type === 'question.requested' ? event.question.appSessionId
      : 'appSessionId' in event ? event.appSessionId : undefined;
    const row = [...this.sessions.values()].find((item) => item.backendId && item.backendId === backendId);
    if (!row || !this.active || row.hidden) return;
    switch (event.type) {
      case 'session.updated': this.updateSummary(row, event.session); break;
      case 'event.appended': if (!row.stopRequested) this.append(row, event.event); break;
      case 'session.history':
        if (event.childSessionId || row.historyVersion === undefined) return;
        if (row.eventVersion === row.historyVersion && !row.busy) {
          row.view.messages = projectHistory(event.transcripts);
          row.view.historyState = 'ready';
          row.view.historyNote = event.olderCursor ? 'Showing the recent conversation. Older messages remain on your computer.' : undefined;
        } else {
          row.view.historyState = 'live';
          row.view.historyNote = 'Live activity resumed. Refresh earlier messages when the turn finishes.';
        }
        delete row.historyVersion;
        this.changed(row);
        break;
      case 'session.history.error':
        delete row.historyVersion;
        row.view.historyState = 'error';
        row.view.historyNote = 'History could not load. Try again after this session settles.';
        this.changed(row);
        break;
      case 'approval.requested':
      case 'question.requested': this.restoreInteractions(row); this.changed(row); break;
      case 'error': this.fail(row, event.message); break;
      case 'session.closed': row.busy = false; row.view.phase = 'stopped'; this.changed(row); break;
    }
  }

  commandReceived(command: ClientCommand): void {
    if (!this.active || (command.type !== 'session.send' && command.type !== 'session.sendNow')) return;
    const row = [...this.sessions.values()].find((item) => item.backendId === command.appSessionId && !item.hidden);
    if (!row || !row.confirmed || !this.inScope(row.confirmed)) return;
    this.append(row, { id: `desktop-prompt:${randomUUID()}`, appSessionId: command.appSessionId,
      sourceSessionId: 'user', role: 'primary', kind: 'text', author: 'user', text: command.text, ts: Date.now() });
  }

  commandCompleted(command: ClientCommand): void {
    this.index.commandCompleted(command);
    if (command.type !== 'approval.respond' && command.type !== 'question.respond') return;
    const row = [...this.sessions.values()].find((item) => item.backendId === command.appSessionId);
    if (!row || row.hidden) return;
    row.view.phase = row.confirmed ? sessionPhase(row.confirmed) : 'ready';
    this.restoreInteractions(row);
    this.changed(row);
  }

  turn(value: unknown): void {
    this.requireActive();
    const body = record(value);
    const id = uuid(body.id);
    const requestId = uuid(body.requestId);
    const prompt = text(body.prompt, 'Message');
    const selection = this.selection(body);
    const signature = createHash('sha256').update(JSON.stringify({ prompt, ...selection })).digest('hex');
    let row = this.sessions.get(id);
    if (row?.requests.has(requestId)) {
      if (row.requests.get(requestId) !== signature) throw new RemoteError(409, 'That request ID was already used for a different message.');
      return;
    }
    if (row?.backendId) this.requireScope(row);
    if (row && (row.hidden || row.busy || row.view.approval || row.view.question || row.view.phase === 'waiting')) {
      throw new RemoteError(409, 'This session is working or waiting for a response. Check its current state.');
    }
    if (!row) {
      if ([...this.sessions.values()].filter((item) => item.createdByPhone && !item.hidden).length >= 6) {
        throw new RemoteError(409, 'Close a mobile-created session before starting another.');
      }
      row = this.newRow(id, selection, prompt.slice(0, 60));
      this.sessions.set(id, row);
    }
    row.view.lastRequestId = requestId;
    row.requests.set(requestId, signature);
    if (row.requests.size > 64) row.requests.delete(row.requests.keys().next().value as string);
    row.busy = true;
    row.dispatching = true;
    row.stopRequested = false;
    row.pendingUserEcho = prompt;
    row.view.runId = randomUUID();
    row.view.phase = 'running';
    row.view.updatedAt = Date.now();
    // Keep the last review visible while the next turn is running.
    delete row.view.error;
    row.view.messages.push({ id: randomUUID(), role: 'user', text: prompt, steps: [] }, { id: randomUUID(), role: 'assistant', text: '', steps: [] });
    trimTranscript(row.view.messages);
    this.changed(row);
    void this.drive(row, prompt, selection, requestId);
  }

  async loadHistory(id: string): Promise<void> {
    const row = this.owned(id);
    if (!row.backendId || row.historyVersion !== undefined) return;
    if (row.busy) {
      row.view.historyState = 'live';
      row.view.historyNote = 'Live activity is connected. Earlier messages load after the current turn.';
      this.changed(row);
      return;
    }
    row.historyVersion = row.eventVersion;
    row.view.historyState = 'loading';
    this.changed(row);
    try {
      await this.runtime.handle({ type: 'session.loadHistory', appSessionId: row.backendId, limit: 200 });
      if (row.historyVersion !== undefined) throw new Error('No history reply');
    } catch {
      delete row.historyVersion;
      row.view.historyState = 'error';
      row.view.historyNote = 'Could not load recent messages. Try again.';
      this.changed(row);
    }
  }

  private async drive(row: SharedSession, prompt: string, selection: RemoteSelection, requestId: string): Promise<void> {
    const runId = row.view.runId;
    try {
      if (!row.backendId) {
        row.creating = true;
        await this.runtime.handle({ type: 'session.create', clientRef: row.clientRef, cwd: this.workspace, title: row.view.title,
          goal: prompt, sessionPurpose: 'chat', interactionMode: selection.mode, modelId: selection.modelId,
          ...(selection.effort ? { reasoningEffort: selection.effort } : {}), autonomy: 'off' });
        row.creating = false;
        if (this.current(row, runId) && !row.backendId && row.view.phase !== 'failed') this.fail(row, 'The desktop could not create this session. Check provider login.');
        return;
      }
      if (!this.index.isLive(row.backendId)) {
        await this.runtime.handle({ type: 'session.resume', appSessionId: row.backendId });
        if (!this.current(row, runId)) return;
      }
      this.requireScope(row);
      if (row.confirmed?.streaming) throw new Error('The desktop started another turn. Wait for it to finish before sending.');
      await this.runtime.handle({ type: 'session.updateSettings', appSessionId: row.backendId, modelId: selection.modelId,
        ...(selection.effort ? { reasoningEffort: selection.effort } : {}), interactionMode: selection.mode, autonomy: 'off' });
      if (!this.current(row, runId) || row.view.phase === 'failed') return;
      if (row.confirmed?.modelId !== selection.modelId || row.confirmed.interactionMode !== selection.mode || (selection.effort && row.confirmed.reasoningEffort !== selection.effort)) {
        throw new Error('The desktop did not confirm this model and effort. No message was sent.');
      }
      this.requireScope(row);
      if (row.confirmed.streaming) throw new Error('This session is already running on the desktop. Your message was not resent.');
      // The desktop seeds a new session from its goal, but follow-ups need an
      // explicit user bubble; the provider's live stream contains assistant deltas.
      this.runtime.announcePrompt(row.backendId, requestId, prompt);
      await this.runtime.handle({ type: 'session.send', appSessionId: row.backendId, text: prompt });
      await this.settle(row, runId);
    } catch (error) {
      row.creating = false;
      if (this.current(row, runId)) this.fail(row, error instanceof Error ? error.message : 'The desktop request failed.');
    } finally {
      row.dispatching = false;
      if (this.current(row, runId) && row.view.phase === 'failed' && !row.confirmed?.streaming) row.busy = false;
    }
  }

  async interrupt(id: string): Promise<void> {
    const row = this.owned(id);
    row.stopRequested = true;
    if (row.backendId) {
      try { await this.runtime.handle({ type: 'session.interrupt', appSessionId: row.backendId }); }
      catch (error) { this.fail(row, 'Stop was not confirmed. Check the computer.'); throw error; }
    }
    delete row.view.approval;
    delete row.view.question;
    row.view.phase = 'stopped';
    settleActivity(row.view.messages, true);
    if (row.backendId) row.busy = false;
    this.changed(row);
  }

  async approve(id: string, value: unknown): Promise<void> {
    const row = this.owned(id);
    const body = record(value);
    if (!row.backendId || !row.approvalRequestId || body.id !== row.view.approval?.id || typeof body.allow !== 'boolean') throw new RemoteError(409, 'This approval is no longer pending.');
    const command: ClientCommand = { type: 'approval.respond', appSessionId: row.backendId, requestId: row.approvalRequestId, outcome: body.allow ? 'proceed_once' : 'cancel' };
    await this.respond(row, command);
  }

  async answer(id: string, value: unknown): Promise<void> {
    const row = this.owned(id);
    const body = record(value);
    if (!row.backendId || !row.questionRequestId || body.id !== row.view.question?.id || !Array.isArray(body.answers)) throw new RemoteError(409, 'This question is no longer pending.');
    const questions = row.view.question?.questions || [];
    if (body.answers.length !== questions.length) throw new RemoteError(400, 'Answer each question.');
    const supplied = body.answers;
    const answers = questions.map((question, index) => ({ index: question.index, question: question.question, answer: text(supplied[index], 'Answer', 4_000) }));
    const command: ClientCommand = { type: 'question.respond', appSessionId: row.backendId, requestId: row.questionRequestId, cancelled: false, answers };
    await this.respond(row, command);
  }

  private async respond(row: SharedSession, command: Extract<ClientCommand, { type: 'approval.respond' | 'question.respond' }>): Promise<void> {
    if (row.responding) throw new RemoteError(409, 'A response is already being delivered.');
    row.responding = command.requestId;
    row.view.phase = row.confirmed ? sessionPhase(row.confirmed) : 'waiting';
    this.restoreInteractions(row);
    this.changed(row);
    try {
      await this.runtime.handle(command);
      this.commandCompleted(command);
    } finally {
      delete row.responding;
      this.restoreInteractions(row);
      this.changed(row);
    }
  }

  async remove(id: string): Promise<void> {
    const row = this.owned(id);
    row.hidden = true;
    row.stopRequested = true;
    this.publish({ type: 'removed', id: row.view.id });
    if (row.backendId) await this.runtime.handle({ type: 'session.close', appSessionId: row.backendId });
  }

  async close(): Promise<void> {
    this.active = false;
    const results = await Promise.allSettled([...this.sessions.values()].flatMap((row) => {
      row.stopRequested = true;
      return row.backendId && row.createdByPhone ? [this.runtime.handle({ type: 'session.close', appSessionId: row.backendId })] : [];
    }));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Access was revoked, but some phone-created sessions could not close. Check the desktop.');
  }

  private importRecent(): void {
    for (const summary of this.index.recent(this.workspace)) {
      const existing = [...this.sessions.values()].find((row) => row.backendId === summary.appSessionId);
      if (existing) {
        if (!existing.hidden) this.updateSummary(existing, summary);
        continue;
      }
      if (this.sessions.size >= 24) break;
      const row = this.newRow(randomUUID(), { modelId: summary.modelId || '', mode: summary.interactionMode === 'spec' ? 'spec' : 'auto' }, summary.title);
      row.createdByPhone = false;
      row.backendId = summary.appSessionId;
      row.view.historyState = 'unloaded';
      this.sessions.set(row.view.id, row);
      this.updateSummary(row, summary);
    }
  }

  private newRow(id: string, selection: RemoteSelection, title: string): SharedSession {
    return { view: { id, runId: randomUUID(), revision: 0, title, workspace: basename(this.workspace), ...selection,
      phase: 'ready', messages: [], changes: [], diffNote: '', updatedAt: Date.now() }, clientRef: `mobile:${randomUUID()}`,
      createdByPhone: true, busy: false, dispatching: false, creating: false, stopRequested: false, hidden: false,
      seen: new Set(), requests: new Map(), eventVersion: 0 };
  }

  private updateSummary(row: SharedSession, summary: SessionSummary): void {
    const wasStreaming = row.confirmed?.streaming === true;
    row.confirmed = summary;
    if (!this.inScope(summary)) {
      row.hidden = true;
      this.publish({ type: 'removed', id: row.view.id });
      return;
    }
    if (!wasStreaming && summary.streaming && !row.dispatching && !row.creating) {
      row.view.runId = randomUUID();
      row.stopRequested = false;
      // Existing review remains visible until the next refresh.
      delete row.view.error;
    }
    row.view.title = summary.title;
    row.view.updatedAt = summary.updatedAt;
    row.view.modelId = summary.modelId || '';
    row.view.effort = summary.reasoningEffort;
    row.view.mode = summary.interactionMode === 'spec' ? 'spec' : 'auto';
    if (wasStreaming && !summary.streaming) settleActivity(row.view.messages, summary.phase === 'failed' || summary.phase === 'paused');
    this.restoreInteractions(row);
    if (row.stopRequested && !summary.streaming) row.busy = false;
    if (row.stopRequested) return;
    if (summary.streaming) row.busy = true;
    else if (!row.dispatching || wasStreaming) row.busy = false;
    if (row.view.approval) row.view.phase = 'approval';
    else if (row.view.question) row.view.phase = 'question';
    else if (!row.dispatching || summary.streaming || wasStreaming) row.view.phase = sessionPhase(summary);
    this.changed(row);
    if (wasStreaming && !summary.streaming && !row.view.approval && !row.view.question && summary.phase !== 'failed' && summary.phase !== 'paused') {
      void this.settle(row, row.view.runId).catch(() => this.fail(row, 'Could not refresh the working-tree review.'));
    }
  }

  private restoreInteractions(row: SharedSession): void {
    if (!row.backendId) return;
    const approval = this.index.permission(row.backendId);
    if (approval && approval.requestId !== row.responding) {
      if (row.approvalRequestId !== approval.requestId) row.view.approval = { id: randomUUID(), title: approval.title, detail: (approval.plan || approval.detail).slice(0, 64_000), kind: approval.kind };
      row.approvalRequestId = approval.requestId;
      row.view.phase = 'approval';
    } else { delete row.approvalRequestId; delete row.view.approval; }
    const question = this.index.question(row.backendId);
    if (question && question.requestId !== row.responding) {
      if (row.questionRequestId !== question.requestId) row.view.question = { id: randomUUID(), questions: question.questions };
      row.questionRequestId = question.requestId;
      row.view.phase = 'question';
    } else { delete row.questionRequestId; delete row.view.question; }
  }

  private append(row: SharedSession, event: TranscriptEvent): void {
    if (event.role !== 'primary' || row.seen.has(event.id)) return;
    row.seen.add(event.id);
    if (row.seen.size > 8_000) row.seen.delete(row.seen.keys().next().value as string);
    row.eventVersion += 1;
    if (event.author === 'user' && row.pendingUserEcho === event.text) { delete row.pendingUserEcho; return; }
    appendTranscript(row.view.messages, event);
    if (trimTranscript(row.view.messages)) row.view.historyNote = 'Showing recent activity. Full history remains on the computer.';
    row.view.updatedAt = Math.max(row.view.updatedAt, event.ts);
    this.changed(row);
  }

  private selection(body: Record<string, unknown>): RemoteSelection {
    const model = this.models.find((option) => option.id === body.modelId);
    if (!model) throw new RemoteError(400, 'Choose a model from this computer’s current catalog.');
    if (body.mode !== 'auto' && body.mode !== 'spec') throw new RemoteError(400, 'Choose Build or Plan.');
    const selection: RemoteSelection = { modelId: model.id, mode: body.mode };
    if (model.efforts.length) {
      if (!model.efforts.includes(body.effort as ReasoningEffort)) throw new RemoteError(400, 'Choose an effort supported by this model.');
      selection.effort = body.effort as ReasoningEffort;
    } else if (body.effort !== undefined && body.effort !== null) throw new RemoteError(400, 'This model does not expose reasoning controls.');
    return selection;
  }

  private owned(id: string): SharedSession {
    this.requireActive();
    const row = this.sessions.get(uuid(id));
    if (!row || row.hidden) throw new RemoteError(404, 'Session not found on this connection.');
    if (row.backendId) this.requireScope(row);
    return row;
  }
  private inScope(summary: SessionSummary): boolean {
    return Boolean(summary.cwd) && resolve(summary.cwd) === resolve(this.workspace) && summary.sessionPurpose !== 'mission-control' && summary.interactionMode !== 'agi';
  }
  private requireScope(row: SharedSession): void {
    const summary = row.backendId ? this.index.summary(row.backendId) : row.confirmed;
    if (!summary || !this.inScope(summary)) throw new RemoteError(403, 'This session is outside the shared project.');
  }
  private requireActive(): void { if (!this.active) throw new RemoteError(410, 'Remote access was disabled. Pair again.'); }
  private current(row: SharedSession, runId: string): boolean { return this.active && !row.hidden && !row.stopRequested && row.view.runId === runId; }
  private changed(row: SharedSession): void {
    row.view.revision += 1;
    if (this.active && !row.hidden) this.publish({ type: 'session', session: structuredClone(row.view) });
  }
  private fail(row: SharedSession, message: string): void {
    row.view.phase = 'failed';
    row.view.error = message.slice(0, 2_000);
    row.busy = row.confirmed?.streaming === true;
    this.changed(row);
  }
  private async settle(row: SharedSession, runId: string): Promise<void> {
    if (!this.current(row, runId) || row.confirmed?.streaming || row.view.phase === 'failed' || row.view.approval || row.view.question || row.settledRunId === runId) return;
    row.settledRunId = runId;
    row.view.phase = 'completed';
    settleActivity(row.view.messages, false);
    row.busy = false;
    this.changed(row);
    const result = await this.diff(this.workspace);
    if (!this.current(row, runId)) return;
    row.view.changes = result.changes;
    row.view.diffNote = result.note;
    this.changed(row);
  }
}
