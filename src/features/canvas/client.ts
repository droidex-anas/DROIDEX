// The renderer's half of the Canvas bridge: correlated requests, and the
// feature-local projection of each canvas a caller is watching. The sidecar
// owns canonical state; nothing here is stored in the root store.

import { bridge } from '../../lib/bridge';
import type { ClientCommand, ServerEvent } from '../../types/bridge';
import { applyCanvasChange } from './applyCanvasChange';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasCommand,
  CanvasErrorCode,
  CanvasEvent,
  CanvasReply,
  CanvasSnapshot,
  CanvasSummary,
  CreateFramesInput,
  CreateFramesResult,
  WriteFilesInput,
  WriteReceipt,
} from './protocol';

const MAX_PENDING_REQUESTS = 32;
const REQUEST_TIMEOUT_MS = 30_000;

/** The transport the client talks through, so a test can supply its own. */
export interface CanvasTransport {
  sendIfConnected(command: ClientCommand): boolean;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

/** A failure the sidecar reported, with the stable code from spec §8. */
export class CanvasRequestError extends Error {
  constructor(
    readonly code: CanvasErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasRequestError';
  }
}

/** Everything a successful request is answered with. */
type ReplyEvent =
  | Extract<CanvasEvent, { type: 'canvas.result'; ok: true }>
  | Extract<CanvasEvent, { type: 'canvas.snapshot' }>;

interface Waiter {
  settle: (event: ReplyEvent) => void;
  fail: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface CanvasBoard {
  /** null until the first snapshot lands. */
  snapshot: CanvasSnapshot | null;
  /** The one snapshot request in flight, which supersedes every change. */
  loading: Promise<CanvasSnapshot> | null;
  listeners: Set<(snapshot: CanvasSnapshot) => void>;
}

export class CanvasClient {
  private readonly pending = new Map<string, Waiter>();
  private readonly boards = new Map<string, CanvasBoard>();
  private listening = false;

  constructor(private readonly transport: CanvasTransport) {}

  listCanvases(): Promise<CanvasSummary[]> {
    return this.request({ type: 'canvas.list', requestId: requestId() }).then(
      (event) => reply(event, 'summaries').summaries,
    );
  }

  /** The canvas this chat works on, or null while it is unattached (spec §6). */
  attachedCanvasId(appSessionId: string): Promise<string | null> {
    return this.request({ type: 'canvas.attachment', requestId: requestId(), appSessionId }).then(
      (event) => reply(event, 'attachment').canvasId,
    );
  }

  /** Explicit Create in the pane: a new canvas, attached to this chat. */
  async createCanvas(appSessionId: string): Promise<string> {
    const event = await this.request({
      type: 'canvas.createCanvas',
      requestId: requestId(),
      appSessionId,
    });
    const canvasId = reply(event, 'attachment').canvasId;
    if (canvasId === null) throw wrongReply();
    return canvasId;
  }

  async attachCanvas(appSessionId: string, canvasId: string): Promise<void> {
    const event = await this.request({
      type: 'canvas.attach',
      requestId: requestId(),
      appSessionId,
      canvasId,
    });
    reply(event, 'attachment');
  }

  async detachCanvas(appSessionId: string): Promise<void> {
    const event = await this.request({
      type: 'canvas.detach',
      requestId: requestId(),
      appSessionId,
    });
    reply(event, 'attachment');
  }

  async createFrames(
    appSessionId: string,
    canvasId: string,
    input: CreateFramesInput,
  ): Promise<CreateFramesResult> {
    const event = await this.request({
      type: 'canvas.create',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'created').created;
  }

  async writeFiles(
    appSessionId: string,
    canvasId: string,
    input: WriteFilesInput,
  ): Promise<WriteReceipt> {
    const event = await this.request({
      type: 'canvas.write',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'written').receipt;
  }

  async arrangeFrames(
    appSessionId: string,
    canvasId: string,
    input: ArrangeFramesInput,
  ): Promise<CanvasChange> {
    const event = await this.request({
      type: 'canvas.arrange',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'arranged').change;
  }

  /** This client's projection of a canvas, once its snapshot has landed. */
  snapshotOf(canvasId: string): CanvasSnapshot | null {
    return this.boards.get(canvasId)?.snapshot ?? null;
  }

  /**
   * Watches a canvas. The listener runs when the first snapshot lands and after
   * every change applied to it. The last listener to leave stops the sidecar
   * from sending that canvas at all.
   */
  subscribeCanvas(canvasId: string, listener: (snapshot: CanvasSnapshot) => void): () => void {
    let board = this.boards.get(canvasId);
    if (!board) {
      board = { snapshot: null, loading: null, listeners: new Set() };
      this.boards.set(canvasId, board);
    }
    board.listeners.add(listener);
    void this.load(canvasId)?.catch(reportLostSnapshot);
    return () => {
      const watching = this.boards.get(canvasId);
      if (!watching?.listeners.delete(listener) || watching.listeners.size > 0) return;
      this.boards.delete(canvasId);
      // A dropped unsubscribe only costs changes this client now ignores.
      void this.request({ type: 'canvas.unsubscribe', requestId: requestId(), canvasId }).catch(
        () => undefined,
      );
    };
  }

  /** Seeds or resyncs one canvas, with a single snapshot request in flight. */
  private load(canvasId: string): Promise<CanvasSnapshot> | null {
    const board = this.boards.get(canvasId);
    if (!board) return null;
    board.loading ??= this.requestSnapshot(canvasId).finally(() => {
      const watching = this.boards.get(canvasId);
      if (watching) watching.loading = null;
    });
    return board.loading;
  }

  private async requestSnapshot(canvasId: string): Promise<CanvasSnapshot> {
    const event = await this.request({
      type: 'canvas.subscribe',
      requestId: requestId(),
      canvasId,
    });
    if (event.type !== 'canvas.snapshot') throw wrongReply();
    this.project(canvasId, event.snapshot);
    return event.snapshot;
  }

  private project(canvasId: string, snapshot: CanvasSnapshot): void {
    const board = this.boards.get(canvasId);
    if (!board) return;
    board.snapshot = snapshot;
    for (const listener of board.listeners) listener(snapshot);
  }

  private request(command: CanvasCommand): Promise<ReplyEvent> {
    if (!this.listening) {
      this.listening = true;
      this.transport.subscribe((event) => {
        this.receive(event);
      });
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS)
      return Promise.reject(new Error('Wait for the current Canvas requests to finish.'));
    return new Promise((settle, fail) => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.requestId);
        fail(new Error('The runtime did not answer that Canvas request.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(command.requestId, { settle, fail, timeout });
      // A mutation must not be replayed from the transport's offline queue.
      if (this.transport.sendIfConnected(command)) return;
      this.pending.delete(command.requestId);
      clearTimeout(timeout);
      fail(new Error('DROIDEX is not connected.'));
    });
  }

  private receive(event: ServerEvent): void {
    if (event.type === 'canvas.change') {
      this.absorb(event.change);
      return;
    }
    if (event.type === 'canvas.snapshot') {
      this.answer(event.requestId)?.settle(event);
      return;
    }
    if (event.type !== 'canvas.result') return;
    const waiter = this.answer(event.requestId);
    if (!waiter) return;
    if (event.ok) waiter.settle(event);
    else waiter.fail(new CanvasRequestError(event.error.code, event.error.message));
  }

  private answer(id: string): Waiter | null {
    const waiter = this.pending.get(id);
    if (!waiter) return null;
    this.pending.delete(id);
    clearTimeout(waiter.timeout);
    return waiter;
  }

  private absorb(change: CanvasChange): void {
    const board = this.boards.get(change.canvasId);
    if (!board) return;
    // A snapshot in flight already carries this change, so it is dropped here.
    if (board.loading) return;
    const current = board.snapshot;
    if (!current) {
      void this.load(change.canvasId)?.catch(reportLostSnapshot);
      return;
    }
    if (change.sequence <= current.sequence) return;
    if (change.sequence === current.sequence + 1) {
      this.project(change.canvasId, applyCanvasChange(current, change));
      return;
    }
    // A gap means a change never arrived, and only a fresh snapshot closes it.
    void this.load(change.canvasId)?.catch(reportLostSnapshot);
  }
}

export const canvasClient = new CanvasClient(bridge);

function requestId(): string {
  return crypto.randomUUID();
}

/**
 * The reply the sidecar answers this command with. TypeScript cannot narrow a
 * union by a generic discriminant, so the kind is checked and then asserted.
 */
function reply<K extends CanvasReply['kind']>(
  event: ReplyEvent,
  kind: K,
): Extract<CanvasReply, { kind: K }> {
  if (event.type !== 'canvas.result' || event.reply.kind !== kind) throw wrongReply();
  return event.reply as Extract<CanvasReply, { kind: K }>;
}

function wrongReply(): Error {
  return new Error('The runtime answered a Canvas request with the wrong reply.');
}

/** A resync this client started for itself has no caller to report to. */
function reportLostSnapshot(error: unknown): void {
  console.error('Canvas could not reload a board:', error);
}
