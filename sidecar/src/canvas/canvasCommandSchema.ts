// The wire shape of every `canvas.*` request the pane may send. Parsing here is
// the bridge's whole validation: past it, `canvasBridge.ts` trusts the command.

import { z } from 'zod';
import {
  arrangeFramesInputSchema,
  canvasIdentifierSchema,
  canvasNameSchema,
  createFramesInputSchema,
  editElementInputSchema,
  removeFramesInputSchema,
  renameFrameInputSchema,
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
