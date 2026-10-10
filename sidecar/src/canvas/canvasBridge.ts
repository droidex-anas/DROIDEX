// The pane's dispatch boundary: it validates every `canvas.*` request, mints
// the user scope that authorizes a mutation, and forwards committed changes to
// the clients watching that canvas. Authority here comes from the chat's
// attachment, not from an agent turn's lease (spec §6).

import { CanvasCaptures, type CanvasCapture } from './canvasCaptures.js';
import { CanvasWatches } from './canvasWatches.js';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ServerEvent } from '../protocol.js';
import type { CanvasBuilds } from './CanvasBuilds.js';
import { canvasError, CanvasCommandError } from './canvasError.js';
import { resolveCanvasAssetReferences } from './canvasAssets.js';
import { canvasCommandSchema, type CanvasMutation } from './canvasCommandSchema.js';
import { editCanvasElement } from './canvasElementEdit.js';
import { restoreRevision } from './canvasRevisionHistory.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasScopes } from './canvasScopes.js';
import type {
  CanvasCommand,
  CanvasError,
  CanvasEvent,
  CanvasReply,
  OwnedAsset,
  PreviewArtifact,
} from './protocol.js';

const MAX_PENDING_REQUESTS = 128;

const UNAVAILABLE = 'Canvas storage is unavailable. Reopen DROIDEX to try again.';
const NO_PAGE = 'Canvas needs a renderer page ID. Reload DROIDEX.';
const WATCH_ENDED = 'That Canvas pane is no longer subscribed.';

/** Validates requests and owns their workspace, scopes and page watches. */
class CanvasDispatch {
  readonly captures: CanvasCaptures;
  private readonly watches: CanvasWatches;
  private readonly workspace: Promise<CanvasWorkspace>;

  constructor(
    ready: Promise<CanvasWorkspace>,
    private readonly scopes: CanvasScopes,
    private readonly builds: CanvasBuilds,
    private readonly assets: {
      secret: string;
      list: (canvasId: string) => Promise<OwnedAsset[]>;
    },
    private readonly emit: (event: ServerEvent) => void,
    onPageGone: (listener: (pageId: string) => void) => () => void,
  ) {
    this.watches = new CanvasWatches(builds, scopes);
    this.captures = new CanvasCaptures(emit, (canvasId) => this.watches.watchingPages(canvasId));
    onPageGone((pageId) => {
      this.watches.forget(pageId);
      this.captures.forget(pageId);
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

  async run(
    command: Exclude<CanvasCommand, { type: 'canvas.reportCapture' }>,
    pageId: string | null,
  ): Promise<CanvasEvent> {
    try {
      if (command.type === 'canvas.subscribe' || command.type === 'canvas.unsubscribe')
        return await this.watch(command, pageId);
      if (command.type === 'canvas.readArtifact') return await this.readArtifact(command);
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
   * `voice.start` already requires one. Subscribing captures its own identity
   * before awaiting storage; unsubscribe or page loss invalidates it immediately.
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
    const watch = this.watches.begin(pageId, command.canvasId);
    const workspace = await this.workspace;
    if (!this.watches.watch(watch)) throw canvasError('scope_expired', WATCH_ENDED);
    // Opening a canvas is when its derived build cache is recovered, so the
    // projection below already reports the frames that are building again, and
    // the client that holds it is exactly the one watching for what extends it.
    this.builds.requestRebuilds(workspace.snapshot(command.canvasId));
    const snapshot = workspace.snapshot(command.canvasId);
    return { type: 'canvas.snapshot', requestId: command.requestId, snapshot };
  }

  private async answer(
    workspace: CanvasWorkspace,
    command: Exclude<
      CanvasCommand,
      { type: `canvas.${'subscribe' | 'unsubscribe' | 'readArtifact' | 'reportCapture'}` }
    >,
  ): Promise<CanvasReply> {
    switch (command.type) {
      case 'canvas.list':
        return { kind: 'summaries', summaries: workspace.listCanvases() };
      case 'canvas.listAssets':
        workspace.snapshot(command.canvasId);
        return { kind: 'assets', assets: await this.assets.list(command.canvasId) };
      case 'canvas.listRevisions':
        return {
          kind: 'revisions',
          revisions: await workspace.history.listRevisions(
            command.canvasId,
            command.designId,
            command.page,
          ),
        };
      case 'canvas.diffRevisions':
        return {
          kind: 'revisionDiff',
          diff: await workspace.history.diffRevisions(
            command.canvasId,
            command.designId,
            command.from,
            command.to,
          ),
        };
      case 'canvas.attachment':
        return { kind: 'attachment', canvasId: workspace.attachedCanvasId(command.appSessionId) };
      case 'canvas.createCanvas': {
        const created = await workspace.createCanvas(
          command.appSessionId,
          command.mutationId,
          command.name,
        );
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
      case 'canvas.reportPreview':
        // The canvas has to be open; the report itself is only the pane's word.
        workspace.snapshot(command.canvasId);
        workspace.previews.record(command.canvasId, command.report);
        return { kind: 'ok' };
      case 'canvas.readSource': {
        // The source drawer and history read one committed revision; an
        // uncommitted tree on disk is refused, and the head never moves.
        const files = await workspace.history.readRevisionFiles(
          command.canvasId,
          command.designId,
          command.revisionId,
        );
        return { kind: 'source', files };
      }
      default:
        return this.mutate(workspace, command);
    }
  }

  private async readArtifact(
    command: Extract<CanvasCommand, { type: 'canvas.readArtifact' }>,
  ): Promise<CanvasEvent> {
    const canRebuild = this.watches.rebuildAuthority(command.canvasId, command.designId);
    await this.workspace;
    const artifact = await this.builds.readArtifact(
      command.canvasId,
      command.designId,
      command.revisionId,
      canRebuild,
    );
    return {
      type: 'canvas.result',
      requestId: command.requestId,
      ok: true,
      reply: {
        kind: 'artifact',
        artifact: artifact && signAssetUrls(artifact, command.canvasId, this.assets.secret),
      },
    };
  }

  /**
   * Runs one pane mutation under a scope that lives exactly as long as the
   * request. The chat's attachment is the authority: a request naming a canvas
   * the chat has left is as stale as a settled turn's lease, and the workspace
   * checks that again in its final commit gate.
   */
  private async mutate(workspace: CanvasWorkspace, command: CanvasMutation): Promise<CanvasReply> {
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
        case 'canvas.editElement':
          return {
            kind: 'written',
            receipt: await editCanvasElement(workspace, this.builds, scope, command.input),
          };
        case 'canvas.restoreRevision':
          return {
            kind: 'written',
            receipt: await restoreRevision(workspace, scope, command.input),
          };
        case 'canvas.arrange':
          return { kind: 'arranged', change: await workspace.arrange(scope, command.input) };
        case 'canvas.remove':
          return {
            kind: 'removed',
            ...(await workspace.removeFrames(
              scope,
              command.input.mutationId,
              command.input.designIds,
            )),
          };
        case 'canvas.undoRemoval':
          return {
            kind: 'undone',
            change: await workspace.undoRemoval(
              scope,
              command.input.mutationId,
              command.input.undoId,
            ),
          };
        case 'canvas.renameFrame':
          return {
            kind: 'renamed',
            change: await workspace.renameFrame(
              scope,
              command.input.mutationId,
              command.input.designId,
              command.input.name,
              command.input.expectedManifestVersion,
            ),
          };
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
  'canvas.remove',
  'canvas.undoRemoval',
  'canvas.renameFrame',
]);

export function createCanvasCommandHandler(
  ready: Promise<CanvasWorkspace>,
  scopes: CanvasScopes,
  builds: CanvasBuilds,
  assets: { secret: string; list: (canvasId: string) => Promise<OwnedAsset[]> },
  emit: (event: ServerEvent) => void,
  onPageGone: (listener: (pageId: string) => void) => () => void,
): {
  handle: (command: unknown, pageId: string | null) => Promise<boolean>;
  capture: CanvasCapture;
} {
  const requests = new Map<string, { input: string; reply: Promise<CanvasEvent>; done: boolean }>();
  const dispatch = new CanvasDispatch(ready, scopes, builds, assets, emit, onPageGone);

  const handle = async (value: unknown, pageId: string | null): Promise<boolean> => {
    if (!isCanvasRequest(value)) return false;
    const parsed = canvasCommandSchema.safeParse(value);
    if (!parsed.success) {
      emit(rejection(value, parsed.error));
      return true;
    }
    const command = parsed.data;
    // A capture answer settles the sidecar's own request. It is never replayed,
    // and its PNG is not retained for request deduplication.
    if (command.type === 'canvas.reportCapture') {
      dispatch.captures.answer(command, pageId);
      emit({
        type: 'canvas.result',
        requestId: command.requestId,
        ok: true,
        reply: { kind: 'ok' },
      });
      return true;
    }
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
  return {
    handle,
    capture: (canvasId, ref, signal) => dispatch.captures.capture(canvasId, ref, signal),
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

/**
 * Owned-asset URLs are signed for the reader, so the artifact ID has to follow
 * the signed document the guest will actually load.
 */
function signAssetUrls(
  artifact: PreviewArtifact,
  canvasId: string,
  secret: string,
): PreviewArtifact {
  const html = resolveCanvasAssetReferences(artifact.html, canvasId, secret);
  return { html, artifactId: createHash('sha256').update(html).digest('hex') };
}

/** A CanvasError passes through; anything else is storage damage we own. */
function canvasFailure(error: unknown): CanvasError {
  if (error instanceof CanvasCommandError)
    return {
      code: error.code,
      message: error.message,
      ...(error.currentRect ? { currentRect: error.currentRect } : {}),
    };
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
