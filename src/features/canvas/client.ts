// The renderer's half of the Canvas bridge: correlated requests, and the
// feature-local projection of each canvas a caller is watching. The sidecar
// owns canonical state; nothing here is stored in the root store.

import type { ClientCommand, ServerEvent } from '../../types/bridge';
import { applyCanvasChange } from './applyCanvasChange';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasCommand,
  CanvasErrorCode,
  FrameRect,
  CanvasEvent,
  CanvasReply,
  CanvasSnapshot,
  CanvasSummary,
  CreateFramesInput,
  CreateFramesResult,
  PreviewArtifact,
  RemoveFramesInput,
  RenameFrameInput,
  UndoRemovalInput,
  WriteFilesInput,
  WriteReceipt,
} from './protocol';

const MAX_PENDING_REQUESTS = 32;
const REQUEST_TIMEOUT_MS = 30_000;
/** How many changes one board holds while a snapshot is in flight. */
const MAX_QUEUED_CHANGES = 256;
/** How many snapshots one resync may take before the board is hopeless. */
const MAX_SNAPSHOT_ATTEMPTS = 4;

/** The transport the client talks through, so a test can supply its own. */
export interface CanvasTransport {
  sendIfConnected(command: ClientCommand): boolean;
  subscribe(listener: (event: ServerEvent) => void): () => void;
  /** Fired after a reconnected socket is admitted, never for the first one. */
  onReconnected(listener: () => void): () => void;
}

/** The short recovery line a Canvas failure carries; never a stack trace. */
export function canvasMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Canvas could not finish that request.';
}

/** A failure the sidecar reported, with the stable code from spec §8. */
class CanvasRequestError extends Error {
  constructor(
    readonly code: CanvasErrorCode,
    message: string,
    readonly currentRect?: FrameRect,
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
  /** The one snapshot request in flight. */
  loading: Promise<CanvasSnapshot> | null;
  // Changes arriving behind a snapshot wait for it. A gap in the bounded
  // queue requests another snapshot instead of silently losing changes.
  queued: CanvasChange[];
  // Dropping or reconnecting the board invalidates every request in flight.
  generation: number;
  listeners: Set<(snapshot: CanvasSnapshot) => void>;
}

export class CanvasClient {
  private readonly pending = new Map<string, Waiter>();
  private readonly boards = new Map<string, CanvasBoard>();
  private readonly summaryListeners = new Set<(summaries: CanvasSummary[]) => void>();
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

  /** Creates and attaches a canvas; `name` overrides storage's provisional name. */
  async createCanvas(
    appSessionId: string,
    mutationId: string,
    name: string | null = null,
  ): Promise<string> {
    const event = await this.request({
      type: 'canvas.createCanvas',
      requestId: requestId(),
      appSessionId,
      mutationId,
      ...(name === null ? {} : { name }),
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

  async removeFrames(
    appSessionId: string,
    canvasId: string,
    input: RemoveFramesInput,
  ): Promise<string> {
    const event = await this.request({
      type: 'canvas.remove',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'removed').undoId;
  }

  async undoRemoval(
    appSessionId: string,
    canvasId: string,
    input: UndoRemovalInput,
  ): Promise<CanvasChange> {
    const event = await this.request({
      type: 'canvas.undoRemoval',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'undone').change;
  }

  async renameFrame(
    appSessionId: string,
    canvasId: string,
    input: RenameFrameInput,
  ): Promise<CanvasChange> {
    const event = await this.request({
      type: 'canvas.renameFrame',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'renamed').change;
  }

  /**
   * The document one built revision produced, or null once the derived cache has
   * lost it. A `ready` frame asks for its own revision and a `failed` frame for
   * its `lastWorkingRevisionId`; both are read the same way.
   */
  async readArtifact(
    canvasId: string,
    designId: string,
    revisionId: string,
  ): Promise<PreviewArtifact | null> {
    const event = await this.request({
      type: 'canvas.readArtifact',
      requestId: requestId(),
      canvasId,
      designId,
      revisionId,
    });
    return reply(event, 'artifact').artifact;
  }

  /** Watches summary broadcasts and re-reads the list after reconnecting. */
  subscribeSummaries(listener: (summaries: CanvasSummary[]) => void): () => void {
    this.listen();
    this.summaryListeners.add(listener);
    return () => {
      this.summaryListeners.delete(listener);
    };
  }

  /** This client's projection of a canvas, once its snapshot has landed. */
  snapshotOf(canvasId: string): CanvasSnapshot | null {
    return this.boards.get(canvasId)?.snapshot ?? null;
  }

  // Delivers the first snapshot and subsequent changes. The last listener
  // leaving removes the sidecar watch.
  subscribeCanvas(canvasId: string, listener: (snapshot: CanvasSnapshot) => void): () => void {
    let board = this.boards.get(canvasId);
    if (!board) {
      board = { snapshot: null, loading: null, queued: [], generation: 0, listeners: new Set() };
      this.boards.set(canvasId, board);
    }
    const watching = board;
    watching.listeners.add(listener);
    void this.load(watching, canvasId).catch(reportLostSnapshot);
    return () => {
      if (!watching.listeners.delete(listener) || watching.listeners.size > 0) return;
      if (this.boards.get(canvasId) === watching) this.boards.delete(canvasId);
      // Abandons whatever this board had in flight, so a late answer cannot
      // reach the board a later subscribe puts in its place.
      watching.generation += 1;
      watching.loading = null;
      watching.queued = [];
      // A dropped unsubscribe only costs changes this client now ignores.
      void this.request({ type: 'canvas.unsubscribe', requestId: requestId(), canvasId }).catch(
        () => undefined,
      );
    };
  }

  /** Seeds or resyncs one canvas, with a single snapshot request in flight. */
  private load(board: CanvasBoard, canvasId: string): Promise<CanvasSnapshot> {
    const running = board.loading;
    if (running) return running;
    const generation = board.generation;
    const loading = this.reload(board, canvasId, generation).finally(() => {
      // A replacement request has its own slot; never release theirs.
      if (board.generation === generation) board.loading = null;
    });
    board.loading = loading;
    return loading;
  }

  /**
   * Takes snapshots until the board is current. A snapshot is taken before the
   * changes queued behind it commit, so the queue is drained onto it, and a gap
   * the queue still shows means another snapshot is owed.
   */
  private async reload(
    board: CanvasBoard,
    canvasId: string,
    generation: number,
  ): Promise<CanvasSnapshot> {
    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const event = await this.request({
        type: 'canvas.subscribe',
        requestId: requestId(),
        canvasId,
      });
      if (event.type !== 'canvas.snapshot') throw wrongReply();
      // This board was dropped, replaced or reconnected while the request was
      // in flight, so its answer belongs to nothing.
      if (board.generation !== generation) return event.snapshot;
      const current = board.snapshot;
      // An answer behind the projection would roll it back; ask again instead.
      if (!current || event.snapshot.sequence >= current.sequence) {
        const caught = this.drain(board, event.snapshot);
        this.project(board, caught.snapshot);
        if (caught.current) return caught.snapshot;
      }
    }
    throw new Error('Canvas could not catch up with the changes on this board.');
  }

  /** Applies the queued changes a snapshot does not already cover. */
  private drain(
    board: CanvasBoard,
    snapshot: CanvasSnapshot,
  ): { snapshot: CanvasSnapshot; current: boolean } {
    const queued = [...board.queued].sort((left, right) => left.sequence - right.sequence);
    board.queued = [];
    let projection = snapshot;
    for (const change of queued) {
      if (change.sequence <= projection.sequence) continue;
      if (change.sequence !== projection.sequence + 1)
        return { snapshot: projection, current: false };
      projection = applyCanvasChange(projection, change);
    }
    return { snapshot: projection, current: true };
  }

  private project(board: CanvasBoard, snapshot: CanvasSnapshot): void {
    board.snapshot = snapshot;
    for (const listener of board.listeners) listener(snapshot);
  }

  // A replay resume emits no connection event, so the transport owns recovery.
  // Re-read boards and lists because the sidecar drops disconnected watches.
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.transport.subscribe((event) => {
      this.receive(event);
    });
    this.transport.onReconnected(() => {
      this.resubscribe();
      this.relist();
    });
  }

  private request(command: CanvasCommand): Promise<ReplyEvent> {
    this.listen();
    if (this.pending.size >= MAX_PENDING_REQUESTS)
      return Promise.reject(new Error('Wait for the current Canvas requests to finish.'));
    return new Promise((settle, fail) => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.requestId);
        fail(new Error('The runtime did not answer that Canvas request.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(command.requestId, { settle, fail, timeout });
      // A mutation must not be replayed from the transport's offline queue: it
      // carries a revision the runtime may have moved past by the time a queue
      // drains. A refused send becomes this request's rejection, so the caller
      // hears about it now instead of waiting out the timeout above.
      if (this.transport.sendIfConnected(command)) return;
      this.pending.delete(command.requestId);
      clearTimeout(timeout);
      fail(new Error('DROIDEX is not connected, so that Canvas request was not sent.'));
    });
  }

  private receive(event: ServerEvent): void {
    if (event.type === 'canvas.change') {
      this.absorb(event.change);
      return;
    }
    if (event.type === 'canvas.summaries') {
      this.publishSummaries(event.summaries);
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
    else
      waiter.fail(
        new CanvasRequestError(event.error.code, event.error.message, event.error.currentRect),
      );
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
    const current = board.snapshot;
    // A snapshot in flight was taken before this change committed, so it waits
    // for that answer rather than being dropped.
    if (board.loading || !current) {
      board.queued.push(change);
      if (board.queued.length > MAX_QUEUED_CHANGES) board.queued.shift();
      if (!board.loading) void this.load(board, change.canvasId).catch(reportLostSnapshot);
      return;
    }
    if (change.sequence <= current.sequence) return;
    if (change.sequence === current.sequence + 1) {
      this.project(board, applyCanvasChange(current, change));
      return;
    }
    // A gap means a change never arrived, and only a fresh snapshot closes it.
    board.queued.push(change);
    void this.load(board, change.canvasId).catch(reportLostSnapshot);
  }

  /** Re-reads the list for whoever is showing it, after a reconnect. */
  private relist(): void {
    if (this.summaryListeners.size === 0) return;
    this.listCanvases().then(
      (summaries) => {
        this.publishSummaries(summaries);
      },
      // A list that could not be re-read leaves the last one on screen; the
      // next change to any canvas broadcasts a fresh one anyway.
      () => undefined,
    );
  }

  private publishSummaries(summaries: CanvasSummary[]): void {
    for (const listener of this.summaryListeners) listener(summaries);
  }

  /** Re-watches every board this client holds and catches each one up. */
  private resubscribe(): void {
    for (const [canvasId, board] of this.boards) {
      board.generation += 1;
      board.loading = null;
      void this.load(board, canvasId).catch(reportLostSnapshot);
    }
  }
}

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
