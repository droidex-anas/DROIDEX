// The pane's dispatch boundary: it validates every `canvas.*` request, mints
// the user scope that authorizes a mutation, and forwards committed changes to
// the clients watching that canvas. Authority here comes from the chat's
// attachment, not from an agent turn's lease (spec §6).

import { z } from 'zod';
import type { ServerEvent } from '../protocol.js';
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

// An appSessionId never reaches a filesystem path, so it is bounded, not
// charset-checked; a requestId is also one turn's scope ID.
const wireId = z.string().min(1).max(200);
const request = { requestId: wireId };
const session = { appSessionId: wireId };
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
  z.object({ type: z.literal('canvas.createCanvas'), ...request, ...session }).strict(),
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

export function createCanvasCommandHandler(
  ready: Promise<CanvasWorkspace>,
  scopes: CanvasScopes,
  emit: (event: ServerEvent) => void,
): (command: unknown) => Promise<boolean> {
  const requests = new Map<string, { input: string; reply: Promise<CanvasEvent>; done: boolean }>();
  // The canvases some client is watching. A change on a canvas nobody has open
  // is not broadcast at all, so an agent's work costs the pane nothing until it
  // is being looked at.
  const watched = new Set<string>();
  const workspace = ready.then((opened) => {
    opened.onChange((change) => {
      if (watched.has(change.canvasId)) emit({ type: 'canvas.change', change });
    });
    return opened;
  });

  return async (value) => {
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
      entry = {
        input: serialized,
        reply: run(workspace, scopes, watched, emit, command),
        done: false,
      };
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

async function run(
  ready: Promise<CanvasWorkspace>,
  scopes: CanvasScopes,
  watched: Set<string>,
  emit: (event: ServerEvent) => void,
  command: CanvasCommand,
): Promise<CanvasEvent> {
  try {
    const workspace = await ready;
    // The snapshot and the watch are one step: a client that holds a projection
    // is exactly the client that needs the changes extending it.
    if (command.type === 'canvas.subscribe') {
      const snapshot = workspace.snapshot(command.canvasId);
      watched.add(command.canvasId);
      return { type: 'canvas.snapshot', requestId: command.requestId, snapshot };
    }
    if (command.type === 'canvas.unsubscribe') {
      watched.delete(command.canvasId);
      return {
        type: 'canvas.result',
        requestId: command.requestId,
        ok: true,
        reply: { kind: 'ok' },
      };
    }
    const reply = await answer(workspace, scopes, command);
    if (CHANGES_SUMMARIES.has(command.type))
      emit({ type: 'canvas.summaries', summaries: workspace.listCanvases() });
    return { type: 'canvas.result', requestId: command.requestId, ok: true, reply };
  } catch (error) {
    return failure(command.requestId, canvasFailure(error));
  }
}

/** The commands that change the saved canvases, their names or their contents. */
const CHANGES_SUMMARIES = new Set<CanvasCommand['type']>([
  'canvas.createCanvas',
  'canvas.attach',
  'canvas.detach',
  'canvas.create',
]);

async function answer(
  workspace: CanvasWorkspace,
  scopes: CanvasScopes,
  command: Exclude<CanvasCommand, { type: `canvas.${'subscribe' | 'unsubscribe'}` }>,
): Promise<CanvasReply> {
  switch (command.type) {
    case 'canvas.list':
      return { kind: 'summaries', summaries: workspace.listCanvases() };
    case 'canvas.attachment':
      return { kind: 'attachment', canvasId: workspace.attachedCanvasId(command.appSessionId) };
    case 'canvas.createCanvas': {
      // Explicit Create in the pane: the canvas and the chat's attachment in one
      // commit, with no lease behind it (spec §6).
      const snapshot = await workspace.createCanvas(command.appSessionId);
      return { kind: 'attachment', canvasId: snapshot.canvasId };
    }
    case 'canvas.attach':
      await workspace.attach(command.appSessionId, command.canvasId);
      return { kind: 'attachment', canvasId: command.canvasId };
    case 'canvas.detach':
      await workspace.detach(command.appSessionId);
      return { kind: 'attachment', canvasId: null };
    default:
      return mutate(workspace, scopes, command);
  }
}

/**
 * Runs one pane mutation under a scope that lives exactly as long as the
 * request. The chat's attachment is the authority: a request naming a canvas
 * the chat has left is as stale as a settled turn's lease.
 */
async function mutate(
  workspace: CanvasWorkspace,
  scopes: CanvasScopes,
  command: Mutation,
): Promise<CanvasReply> {
  const { appSessionId, canvasId } = command;
  if (workspace.attachedCanvasId(appSessionId) !== canvasId)
    throw canvasError('scope_expired', 'This chat is not attached to that canvas.');
  const scope = {
    origin: 'user',
    scopeId: command.requestId,
    appSessionId,
    canvasId,
    allowedDesignIds: 'canvas',
  } as const;
  scopes.register(scope);
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
    scopes.revoke(command.requestId);
  }
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
