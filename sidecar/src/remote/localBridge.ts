import { isRecord } from '../../../packages/remote/src/crypto.js';
import {
  localEvent,
  type LocalSession,
  type LocalApproval,
  type LocalTranscript,
  type LocalEvent,
} from './localEvents.js';
import WebSocket, { type RawData } from 'ws';
import { BRIDGE_PROTOCOL_VERSION, type ClientCommand } from '../protocol.js';
import type {
  RemoteCommand,
  RemoteMessage,
  RemoteSession,
} from '../../../packages/remote/src/application.js';

export class RemoteLocalBridge {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshot = '';
  private generation = 0;
  private readonly sessions = new Map<string, LocalSession>();
  private readonly approvals = new Map<string, LocalApproval>();
  private readonly history = new Map<string, string>();
  private readonly lastText = new Map<string, { id: string; text: string; author?: 'user' }>();

  constructor(
    private readonly options: {
      bridgeInfo: () => Promise<{ port: number; token: string }>;
      workspace: () => string;
      publish: (message: RemoteMessage) => void;
    },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.lastSnapshot = '';
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.socket?.close();
    this.socket = null;
    this.sessions.clear();
    this.approvals.clear();
    this.history.clear();
    this.lastText.clear();
  }

  snapshot(): RemoteMessage {
    const sessions: RemoteSession[] = [...this.sessions.values()].slice(0, 200).map((session) => ({
      id: session.appSessionId,
      title: session.title.slice(0, 160),
      provider: session.provider,
      status: this.statusFor(session),
      supervised: session.autonomy === 'off',
    }));
    const approvals = [...this.approvals.values()].slice(0, 32).map((request) => ({
      id: request.requestId,
      sessionId: request.appSessionId,
      title: request.title.slice(0, 160),
      detail: request.detail.slice(0, 800),
      risky: true,
    }));
    const result: Extract<RemoteMessage, { type: 'snapshot' }> = {
      type: 'snapshot',
      sessions: [],
      approvals: [],
    };
    let bytes = 60;
    for (const approval of approvals) {
      const size = Buffer.byteLength(JSON.stringify(approval));
      if (bytes + size > 14_000) break;
      result.approvals.push(approval);
      bytes += size + 1;
    }
    for (const session of sessions) {
      const size = Buffer.byteLength(JSON.stringify(session));
      if (bytes + size > 40_000) break;
      result.sessions.push(session);
      bytes += size + 1;
    }
    return result;
  }

  needsApproval(command: RemoteCommand): boolean {
    return (
      command.type === 'create' || (command.type === 'approval' && command.decision === 'approve')
    );
  }

  describe(command: RemoteCommand): string {
    if (command.type === 'create')
      return `Start a supervised ${command.provider} task: ${command.text.slice(0, 600)}`;
    if (command.type === 'approval') {
      const request = this.approvals.get(command.requestId);
      if (!request) throw new Error('This approval is no longer pending');
      return `${request.title}\n${request.detail.slice(0, 1600)}`;
    }
    throw new Error('Action does not need approval');
  }

  execute(command: RemoteCommand): void {
    if (command.type === 'push.subscribe' || command.type === 'push.unsubscribe')
      throw new Error('Push subscriptions are handled by the remote host');
    if (command.type === 'usage') throw new Error('Usage is handled by the remote host');
    if (command.type === 'list') {
      this.send({ type: 'remote.snapshot' });
      return;
    }
    if (command.type === 'create') {
      this.send({
        type: 'session.create',
        clientRef: crypto.randomUUID(),
        title: command.text.slice(0, 80),
        goal: command.text,
        provider: command.provider,
        cwd: this.options.workspace() || undefined,
        sessionPurpose: 'chat',
        interactionMode: 'auto',
        autonomy: 'off',
      });
      return;
    }
    if (command.type === 'approval') {
      const request = this.approvals.get(command.requestId);
      if (!request) throw new Error('This approval is no longer pending');
      this.send({
        type: 'approval.respond',
        appSessionId: request.appSessionId,
        requestId: request.requestId,
        outcome: command.decision === 'approve' ? 'proceed_once' : 'cancel',
      });
      this.approvals.delete(command.requestId);
      this.options.publish(this.snapshot());
      return;
    }
    const session = this.sessions.get(command.sessionId);
    if (!session) throw new Error('This task is no longer available');
    if (command.type === 'open') {
      this.options.publish({
        type: 'history',
        sessionId: command.sessionId,
        text: this.history.get(command.sessionId) ?? '',
      });
      if (!session.streaming)
        this.send({ type: 'session.loadHistory', appSessionId: command.sessionId, limit: 30 });
    } else if (command.type === 'pause' || command.type === 'stop') {
      this.send({ type: 'session.interrupt', appSessionId: command.sessionId });
    } else {
      if (session.autonomy !== 'off')
        throw new Error('Set this task to Supervised on your laptop before sending remotely');
      this.send({
        type: 'session.send',
        appSessionId: command.sessionId,
        text: command.text,
        remote: true,
        ...(command.type === 'steer' ? { steerId: crypto.randomUUID() } : {}),
      });
    }
  }

  private statusFor(session: LocalSession): RemoteSession['status'] {
    if (this.hasApproval(session.appSessionId)) return 'waiting';
    if (session.streaming) return 'running';
    if (session.phase === 'completed') return 'done';
    if (session.phase === 'failed') return 'failed';
    return 'paused';
  }
  private hasApproval(id: string): boolean {
    for (const request of this.approvals.values()) if (request.appSessionId === id) return true;
    return false;
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    try {
      const info = await this.options.bridgeInfo();
      if (!this.running || generation !== this.generation) return;
      const params = new URLSearchParams({
        token: info.token,
        bridgeProtocol: String(BRIDGE_PROTOCOL_VERSION),
      });
      const socket = new WebSocket(`ws://127.0.0.1:${String(info.port)}/?${params}`, {
        maxPayload: 8 * 1024 * 1024,
      });
      this.socket = socket;
      socket.on('open', () => {
        if (this.socket === socket) this.send({ type: 'remote.snapshot' });
      });
      socket.on('message', (raw) => {
        if (this.socket !== socket) return;
        try {
          const value: unknown = JSON.parse(rawText(raw));
          if (!isRecord(value)) throw new Error('Invalid local bridge frame');
          if (value.type === 'events.batch' && Array.isArray(value.events)) {
            for (const item of value.events) if (isRecord(item)) this.receive(item.event);
          } else if (
            value.type === 'bridge.snapshot' &&
            isRecord(value.snapshot) &&
            Array.isArray(value.snapshot.sessions)
          ) {
            this.sessions.clear();
            this.approvals.clear();
            this.history.clear();
            this.lastText.clear();
            const sessions: unknown[] = value.snapshot.sessions;
            for (const session of sessions) this.receive({ type: 'session.updated', session });
          } else this.receive(value);
        } catch {
          socket.close(1002, 'invalid local bridge message');
        }
      });
      socket.on('error', () => {
        socket.close();
      });
      socket.on('close', () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.sessions.clear();
        this.approvals.clear();
        this.history.clear();
        this.lastText.clear();
        this.options.publish({ type: 'result', ok: false, message: 'Agent runtime reconnecting' });
        this.schedule();
      });
    } catch {
      if (this.running && generation === this.generation) this.schedule();
    }
  }

  private schedule(): void {
    if (this.running)
      this.retry = setTimeout(() => {
        this.retry = null;
        void this.connect();
      }, 1500);
  }

  private send(command: ClientCommand): void {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error('Agent runtime is reconnecting');
    this.socket.send(JSON.stringify(command));
  }

  private receive(value: unknown): void {
    const parsed = localEvent.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === 'session.updated' || event.type === 'session.created') {
      if (!this.sessions.has(event.session.appSessionId) && this.sessions.size >= 200) {
        const oldest = this.sessions.keys().next().value;
        if (oldest) {
          this.sessions.delete(oldest);
          this.history.delete(oldest);
          this.lastText.delete(oldest);
        }
      }
      this.sessions.set(event.session.appSessionId, event.session);
    } else if (event.type === 'remote.snapshot') {
      this.sessions.clear();
      this.approvals.clear();
      for (const session of event.sessions.slice(0, 200))
        this.sessions.set(session.appSessionId, session);
      for (const request of event.approvals.slice(0, 32))
        this.approvals.set(request.requestId, request);
    } else if (event.type === 'sessions.list') {
      this.sessions.clear();
      for (const session of event.sessions.slice(0, 200))
        this.sessions.set(session.appSessionId, session);
    } else if (event.type === 'session.closed') {
      this.sessions.delete(event.appSessionId);
      this.history.delete(event.appSessionId);
      this.lastText.delete(event.appSessionId);
      for (const [id, request] of this.approvals)
        if (request.appSessionId === event.appSessionId) this.approvals.delete(id);
    } else if (event.type === 'approval.requested') {
      if (this.approvals.size < 32) this.approvals.set(event.request.requestId, event.request);
    } else if (event.type === 'interaction.cancelled') {
      this.approvals.delete(event.requestId);
    } else if (event.type === 'event.appended') {
      this.appendText(event.event);
      return;
    } else {
      this.loadHistory(event);
      return;
    }
    if (
      event.type === 'approval.requested' ||
      event.type === 'interaction.cancelled' ||
      event.type === 'remote.snapshot'
    )
      this.publishSnapshot(event.type === 'remote.snapshot');
    else
      this.snapshotTimer ??= setTimeout(() => {
        this.snapshotTimer = null;
        this.publishSnapshot();
      }, 100);
  }
  private appendText(event: LocalTranscript): void {
    const { appSessionId, text, kind, id, author, role } = event;
    if (
      kind !== 'text' ||
      !text ||
      role === 'worker' ||
      role === 'validator' ||
      !this.sessions.has(appSessionId)
    )
      return;
    const chunk = text.slice(-8000),
      previous = this.lastText.get(appSessionId);
    const separator = author === 'user' || previous?.author === 'user' ? '\n\n' : '';
    if (previous?.id === id) {
      this.history.set(
        appSessionId,
        `${(this.history.get(appSessionId) ?? '').slice(0, -previous.text.length)}${chunk}`.slice(
          -8000,
        ),
      );
      this.options.publish({
        type: 'history',
        sessionId: appSessionId,
        text: this.history.get(appSessionId) ?? '',
      });
    } else {
      this.history.set(
        appSessionId,
        `${this.history.get(appSessionId) ?? ''}${separator}${chunk}`.slice(-8000),
      );
      this.options.publish({
        type: 'stream',
        sessionId: appSessionId,
        text: `${separator}${chunk}`,
      });
    }
    this.lastText.set(appSessionId, { id, text: chunk, author });
  }
  private loadHistory(event: Extract<LocalEvent, { type: 'session.history' }>): void {
    if (
      event.childSessionId ||
      !this.sessions.has(event.appSessionId) ||
      this.sessions.get(event.appSessionId)?.streaming
    )
      return;
    let text = '',
      previousAuthor: 'user' | undefined;
    for (const row of event.transcripts) {
      if (row.kind !== 'text' || !row.text) continue;
      text += `${row.author === 'user' || previousAuthor === 'user' ? '\n\n' : ''}${row.text}`;
      previousAuthor = row.author;
    }
    text = text.slice(-8000);
    if (!text && this.history.has(event.appSessionId)) return;
    this.history.set(event.appSessionId, text);
    this.lastText.delete(event.appSessionId);
    this.options.publish({ type: 'history', sessionId: event.appSessionId, text });
  }
  private publishSnapshot(force = false): void {
    const snapshot = this.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (!force && serialized === this.lastSnapshot) return;
    this.lastSnapshot = serialized;
    this.options.publish(snapshot);
  }
}

function rawText(raw: RawData): string {
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return raw.toString('utf8');
}
