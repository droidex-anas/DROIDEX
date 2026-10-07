// The pane's dispatch boundary: it validates every `canvas.*` request, mints
// the user scope that authorizes a mutation, and forwards committed changes to
// the clients watching that canvas. Authority here comes from the chat's
// attachment, not from an agent turn's lease (spec §6).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ServerEvent } from '../protocol.js';
import type { CanvasBuilds } from './CanvasBuilds.js';
import { canvasError, CanvasCommandError } from './canvasError.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasScopes } from './canvasScopes.js';
import type { CanvasCommand, CanvasError, CanvasEvent, CanvasReply } from './protocol.js';
import {
  arrangeFramesInputSchema,
  canvasIdentifierSchema,
  createFramesInputSchema,
  writeFilesInputSchema,
} from './schema.js';

/** Bounds the correlation table, the way the Projects bridge bounds its own. */
const MAX_PENDING_REQUESTS = 128;

const UNAVAILABLE = 'Canvas storage is unavailable. Reopen DROIDEX to try again.';
const NO_PAGE = 'Canvas needs a renderer page ID. Reload DROIDEX.';
const PAGE_GONE = 'That DROIDEX page is no longer connected.';

// A requestId correlates one reply and nothing else, so it shares the canvas
// identifier rule and the renderer validator can hold the same bound. An
// appSessionId never reaches a filesystem path, so it is bounded, not
// charset-checked.
const request = { requestId: canvasIdentifierSchema };
const session = { appSessionId: z.string().min(1).max(200) };
const target = { ...session, canvasId: canvasIdentifierSchema };

const canvasCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('canvas.list'), ...request }).strict(),
  z.object({ type: z.literal('canvas.attachment'), ...request, ...session }).strict(),
  z
    .object({ type: z.literal('canvas.subscribe'), ...request, canvasId: canvasIdentifierSchema })
    .strict(),
  z
    .object({ type: z.literal('canvas.unsubscribe'), ...request, canvasId: canvasIdentifierSchema })
    .strict(),
  z
    .object({
      type: z.literal('canvas.readArtifact'),
      ...request,
      canvasId: canvasIdentifierSchema,
      designId: canvasIdentifierSchema,
      revisionId: canvasIdentifierSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.createCanvas'),
      ...request,
      ...session,
      mutationId: canvasIdentifierSchema,
    })
    .strict(),
  z.object({ type: z.literal('canvas.attach'), ...request, ...target }).strict(),
  z.object({ type: z.literal('canvas.detach'), ...request, ...session }).strict(),
  z
    .object({
      type: z.literal('canvas.create'),
      ...request,
      ...target,
      input: createFramesInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.write'),
      ...request,
      ...target,
      input: writeFilesInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.arrange'),
      ...request,
      ...target,
      input: arrangeFramesInputSchema,
    })
    .strict(),
]);

type Mutation = Extract<CanvasCommand, { type: `canvas.${'create' | 'write' | 'arrange'}` }>;

/**
 * One renderer page's watch set. The set's own identity is the page's lifetime:
 * a caller that awaits captures this before the await and hands it back after,
 * which is how a watch cannot be installed for a page that went away in between.
 */
interface PageWatches {
  pageId: string;
  open: Set<string>;
}

/**
 * Which canvases each renderer page is watching. A change on a canvas no page
 * has open is never broadcast, and one page closing its pane cannot silence
 * another page that still has the same canvas open.
 */
class CanvasWatches {
  private readonly byPage = new Map<string, Set<string>>();

  /** The page's live watch set, which only `forget` ever replaces. */
  live(pageId: string): PageWatches {
    const open = this.byPage.get(pageId) ?? new Set<string>();
    this.byPage.set(pageId, open);
    return { pageId, open };
  }

  /** False when that page is already gone, so nothing was installed. */
  watch(page: PageWatches, canvasId: string): boolean {
    if (!this.isLive(page)) return false;
    page.open.add(canvasId);
    return true;
  }

  /** By page ID, because unsubscribing awaits nothing and needs no token. */
  unwatch(pageId: string, canvasId: string): void {
    this.byPage.get(pageId)?.delete(canvasId);
  }

  /** A page that reloaded or closed holds nothing; its watches go with it. */
  forget(pageId: string): void {
    this.byPage.delete(pageId);
  }

  isWatched(canvasId: string): boolean {
    for (const open of this.byPage.values()) if (open.has(canvasId)) return true;
    return false;
  }

  private isLive(page: PageWatches): boolean {
    return this.byPage.get(page.pageId) === page.open;
  }
}

/**
 * The owner of one sidecar's Canvas dispatch: the workspace it answers from,
 * the scopes it mints, and which page is watching what.
 */
class CanvasDispatch {
  private readonly watches = new CanvasWatches();
  private readonly workspace: Promise<CanvasWorkspace>;

  constructor(
    ready: Promise<CanvasWorkspace>,
    private readonly scopes: CanvasScopes,
    private readonly builds: CanvasBuilds,
    private readonly emit: (event: ServerEvent) => void,
    onPageGone: (listener: (pageId: string) => void) => () => void,
  ) {
    onPageGone((pageId) => {
      this.watches.forget(pageId);
    });
    this.workspace = ready.then(
      (opened) => {
        opened.changes.subscribe((change) => {
          if (this.watches.isWatched(change.canvasId)) this.emit({ type: 'canvas.change', change });
        });
        return opened;
      },
      () => {
        // The owner that opened the workspace reports the failure; from here
        // every command answers the same way until DROIDEX restarts.
        throw canvasError('storage_failed', UNAVAILABLE);
      },
    );
    // Nothing awaits this until the first command arrives, and an open that
    // failed must not take the sidecar down with an unhandled rejection.
    void this.workspace.catch(() => undefined);
  }

  async run(command: CanvasCommand, pageId: string | null): Promise<CanvasEvent> {
    try {
      if (command.type === 'canvas.subscribe' || command.type === 'canvas.unsubscribe')
        return await this.watch(command, pageId);
      const workspace = await this.workspace;
      const reply = await this.answer(workspace, command);
      if (CHANGES_SUMMARIES.has(command.type))
        this.emit({ type: 'canvas.summaries', summaries: workspace.listCanvases() });
      return { type: 'canvas.result', requestId: command.requestId, ok: true, reply };
    } catch (error) {
      return failure(command.requestId, canvasFailure(error));
    }
  }

  /**
   * Starts or stops watching one canvas. A page identity is required, as
   * `voice.start` already requires one. Subscribing captures the page before it
   * awaits the workspace, because a watch installed for a page that went away
   * during that await would never be released. Unsubscribing awaits nothing, so
   * a client can still drop a watch while Canvas storage is unavailable.
   */
  private async watch(
    command: Extract<CanvasCommand, { type: `canvas.${'subscribe' | 'unsubscribe'}` }>,
    pageId: string | null,
  ): Promise<CanvasEvent> {
    if (pageId === null) throw canvasError('invalid_input', NO_PAGE);
    if (command.type === 'canvas.unsubscribe') {
      this.watches.unwatch(pageId, command.canvasId);
      return {
        type: 'canvas.result',
        requestId: command.requestId,
        ok: true,
        reply: { kind: 'ok' },
      };
    }
    const page = this.watches.live(pageId);
    const workspace = await this.workspace;
    // The watch goes in first: a page that went away while Canvas storage
    // opened is handed no projection and has no work scheduled for it.
    if (!this.watches.watch(page, command.canvasId)) throw canvasError('scope_expired', PAGE_GONE);
    // Opening a canvas is when its derived build cache is recovered, so the
    // projection below already reports the frames that are building again, and
    // the client that holds it is exactly the one watching for what extends it.
    this.builds.requestRebuilds(workspace.snapshot(command.canvasId));
    const snapshot = workspace.snapshot(command.canvasId);
    return { type: 'canvas.snapshot', requestId: command.requestId, snapshot };
  }

  private async answer(
    workspace: CanvasWorkspace,
    command: Exclude<CanvasCommand, { type: `canvas.${'subscribe' | 'unsubscribe'}` }>,
  ): Promise<CanvasReply> {
    switch (command.type) {
      case 'canvas.list':
        return { kind: 'summaries', summaries: workspace.listCanvases() };
      case 'canvas.attachment':
        return { kind: 'attachment', canvasId: workspace.attachedCanvasId(command.appSessionId) };
      case 'canvas.createCanvas': {
        // Explicit Create in the pane: the canvas and the chat's attachment in
        // one commit, with no lease behind it (spec §6).
        const created = await workspace.createCanvas(command.appSessionId, command.mutationId);
        return {
          kind: 'canvasCreated',
          canvasId: created.canvasId,
          attachedCanvasId: workspace.attachedCanvasId(command.appSessionId),
        };
      }
      case 'canvas.attach':
        await workspace.attach(command.appSessionId, command.canvasId);
        return { kind: 'attachment', canvasId: command.canvasId };
      case 'canvas.detach':
        await workspace.detach(command.appSessionId);
        return { kind: 'attachment', canvasId: null };
      case 'canvas.readArtifact': {
        // A derived read: the frame the renderer holds already names the revision
        // the manifest vouches for, and a cache that has lost it answers null so
        // the pane can ask for a rebuild.
        const artifact = await this.builds.readArtifact(
          command.canvasId,
          command.designId,
          command.revisionId,
        );
        return { kind: 'artifact', artifact };
      }
      default:
        return this.mutate(workspace, command);
    }
  }

  /**
   * Runs one pane mutation under a scope that lives exactly as long as the
   * request. The chat's attachment is the authority: a request naming a canvas
   * the chat has left is as stale as a settled turn's lease, and the workspace
   * checks that again in its final commit gate.
   */
  private async mutate(workspace: CanvasWorkspace, command: Mutation): Promise<CanvasReply> {
    const { appSessionId, canvasId } = command;
    if (workspace.attachedCanvasId(appSessionId) !== canvasId)
      throw canvasError('scope_expired', 'This chat is not attached to that canvas.');
    // The scope ID is minted here, never taken from the request: a client that
    // could name a scope could revive a revoked turn's lease.
    const scope = {
      origin: 'user',
      scopeId: `user:${randomUUID()}`,
      appSessionId,
      canvasId,
      allowedDesignIds: 'canvas',
    } as const;
    this.scopes.register(scope);
    try {
      switch (command.type) {
        case 'canvas.create':
          return { kind: 'created', created: await workspace.create(scope, command.input) };
        case 'canvas.write':
          return { kind: 'written', receipt: await workspace.write(scope, command.input) };
        case 'canvas.arrange':
          return { kind: 'arranged', change: await workspace.arrange(scope, command.input) };
      }
    } finally {
      this.scopes.revoke(scope.scopeId);
    }
  }
}

/** The commands that change the saved canvases, their names or their contents. */
const CHANGES_SUMMARIES = new Set<CanvasCommand['type']>([
  'canvas.createCanvas',
  'canvas.attach',
  'canvas.detach',
  'canvas.create',
]);

export function createCanvasCommandHandler(
  ready: Promise<CanvasWorkspace>,
  scopes: CanvasScopes,
  builds: CanvasBuilds,
  emit: (event: ServerEvent) => void,
  onPageGone: (listener: (pageId: string) => void) => () => void,
): (command: unknown, pageId: string | null) => Promise<boolean> {
  const requests = new Map<string, { input: string; reply: Promise<CanvasEvent>; done: boolean }>();
  const dispatch = new CanvasDispatch(ready, scopes, builds, emit, onPageGone);

  return async (value, pageId) => {
    if (!isCanvasRequest(value)) return false;
    const parsed = canvasCommandSchema.safeParse(value);
    if (!parsed.success) {
      emit(rejection(value, parsed.error));
      return true;
    }
    const command = parsed.data;
    const serialized = JSON.stringify(command);
    let entry = requests.get(command.requestId);
    if (entry && entry.input !== serialized) {
      emit(
        failure(command.requestId, {
          code: 'invalid_input',
          message: 'Request identity was reused with different arguments. Use a new request ID.',
        }),
      );
      return true;
    }
    // The durable mutation deduplicates Create; a settled request's attachment
    // is not a receipt and must be read again on replay.
    if (entry?.done && command.type === 'canvas.createCanvas') {
      requests.delete(command.requestId);
      entry = undefined;
    }
    if (!entry) {
      for (const [key, pending] of requests) {
        if (requests.size < MAX_PENDING_REQUESTS) break;
        if (pending.done) requests.delete(key);
      }
      if (requests.size >= MAX_PENDING_REQUESTS) {
        emit(
          failure(command.requestId, {
            code: 'storage_failed',
            message: 'Too many Canvas requests are in flight. Try again in a moment.',
          }),
        );
        return true;
      }
      entry = { input: serialized, reply: dispatch.run(command, pageId), done: false };
      requests.set(command.requestId, entry);
      const settled = entry;
      void settled.reply.then(() => {
        settled.done = true;
      });
    }
    emit(await entry.reply);
    return true;
  };
}

/**
 * Spec §8: a rejected argument under `files` or `deletedPaths` is an invalid
 * source path and everything else is invalid input. Only the first issue's own
 * message travels; the raw validation error and the payload never do.
 */
function rejection(value: Record<string, unknown>, error: z.ZodError): ServerEvent {
  // A failed parse always carries at least one issue.
  const [issue] = error.issues;
  const underSource = issue.path.some((key) => key === 'files' || key === 'deletedPaths');
  const failed: CanvasError = {
    code: underSource ? 'invalid_source_path' : 'invalid_input',
    message: issue.message,
  };
  if (typeof value.requestId === 'string' && value.requestId.length > 0)
    return failure(value.requestId, failed);
  // Nothing to correlate the rejection with, so it can only be reported as a
  // connection-level error.
  return { type: 'error', code: `canvas.${failed.code}`, message: failed.message };
}

function failure(requestId: string, error: CanvasError): CanvasEvent {
  return { type: 'canvas.result', requestId, ok: false, error };
}

/** A CanvasError passes through; anything else is storage damage we own. */
function canvasFailure(error: unknown): CanvasError {
  if (error instanceof CanvasCommandError) return { code: error.code, message: error.message };
  console.error('Canvas command failed:', error);
  return {
    code: 'storage_failed',
    message: 'That Canvas request could not be completed. Reopen DROIDEX and try again.',
  };
}

function isCanvasRequest(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string')
    return false;
  return value.type.startsWith('canvas.');
}
