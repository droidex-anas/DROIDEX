// The validated shape of every `canvas.*` request the pane may send. The
// renderer mirror in protocol.ts must describe exactly what this accepts.

import { z } from 'zod';
import type { CanvasCommand } from './protocol.js';
import {
  arrangeFramesInputSchema,
  canvasIdentifierSchema,
  canvasNameSchema,
  createFramesInputSchema,
  editElementInputSchema,
  removeFramesInputSchema,
  renameFrameInputSchema,
  restoreRevisionInputSchema,
  revisionPageSchema,
  undoRemovalInputSchema,
  writeFilesInputSchema,
} from './schema.js';

// A requestId correlates one reply and nothing else, so it shares the canvas
// identifier rule and the renderer validator can hold the same bound. An
// appSessionId never reaches a filesystem path, so it is bounded, not
// charset-checked.
const request = { requestId: canvasIdentifierSchema };
const session = { appSessionId: z.string().min(1).max(200) };
const target = { ...session, canvasId: canvasIdentifierSchema };

export const canvasCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('canvas.list'), ...request }).strict(),
  z
    .object({ type: z.literal('canvas.listAssets'), ...request, canvasId: canvasIdentifierSchema })
    .strict(),
  z.object({ type: z.literal('canvas.attachment'), ...request, ...session }).strict(),
  z
    .object({
      type: z.literal('canvas.listRevisions'),
      ...request,
      canvasId: canvasIdentifierSchema,
      designId: canvasIdentifierSchema,
      page: revisionPageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.diffRevisions'),
      ...request,
      canvasId: canvasIdentifierSchema,
      designId: canvasIdentifierSchema,
      from: canvasIdentifierSchema,
      to: canvasIdentifierSchema,
    })
    .strict(),
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
      type: z.literal('canvas.reportPreview'),
      ...request,
      canvasId: canvasIdentifierSchema,
      report: z
        .object({
          designId: canvasIdentifierSchema,
          revisionId: canvasIdentifierSchema,
          outcome: z.enum(['loading', 'rendered', 'failed']),
          // The preview's own caps: eight diagnostics of at most 512 bytes each.
          errors: z.array(z.string().max(512)).max(8),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.readSource'),
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
      name: canvasNameSchema.optional(),
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
      type: z.literal('canvas.editElement'),
      ...request,
      ...target,
      input: editElementInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.restoreRevision'),
      ...request,
      ...target,
      input: restoreRevisionInputSchema,
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
  z
    .object({
      type: z.literal('canvas.remove'),
      ...request,
      ...target,
      input: removeFramesInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.undoRemoval'),
      ...request,
      ...target,
      input: undoRemovalInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('canvas.renameFrame'),
      ...request,
      ...target,
      input: renameFrameInputSchema,
    })
    .strict(),
]);

/** The commands that run under a request-scoped user lease. */
export type CanvasMutation = Extract<
  CanvasCommand,
  {
    type: `canvas.${
      | 'create'
      | 'write'
      | 'editElement'
      | 'restoreRevision'
      | 'arrange'
      | 'remove'
      | 'undoRemoval'
      | 'renameFrame'}`;
  }
>;
