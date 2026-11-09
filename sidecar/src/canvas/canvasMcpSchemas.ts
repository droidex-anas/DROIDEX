// The argument schemas of the canvas MCP tools. A mutation needs the scopeId
// its turn's canvas_read returned; a read may omit it to use the active turn.

import { z } from 'zod';
import { kitSaveShape } from './canvasMcpDesignSystemSave.js';
import { annotateCanvasInputSchema } from './canvasAnnotationSchema.js';
import {
  arrangeFramesInputSchema,
  canvasIdentifierSchema,
  createFramesInputSchema,
  designSystemRefSchema,
  writeFilesInputSchema,
} from './schema.js';

export const scopeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The exact scopeId returned by this turn’s canvas_read. Never invent an ID or reuse one from an earlier turn.',
  );
export const scopeShape = {
  scopeId: scopeIdSchema
    .optional()
    .describe(
      'Omit scopeId to begin the turn. Only supply a scopeId this turn’s canvas_read returned to keep reading that lease’s pinned references.',
    ),
};
export const mutationScopeShape = { scopeId: scopeIdSchema };
export const scopeArgumentSchema = z.object(scopeShape).passthrough();
export const pageSchema = z.number().int().min(0).max(100_000);
export const readSchema = z
  .object({
    ...scopeShape,
    view: z.enum(['summary', 'design']).default('summary'),
    designId: canvasIdentifierSchema.optional(),
    revisionId: canvasIdentifierSchema.optional(),
    elementId: canvasIdentifierSchema.optional(),
    paths: z.array(z.string().min(1).max(256)).max(16).optional(),
    offset: pageSchema.default(0),
    limit: z.number().int().min(1).max(32).default(32),
  })
  .strict()
  .refine((input) => input.view === 'design' || !input.elementId, 'elementId needs view design.');
export const createSchema = createFramesInputSchema.extend(mutationScopeShape).strict();
export const writeSchema = z
  .object({ ...writeFilesInputSchema.innerType().shape, ...mutationScopeShape })
  .strict();
export const arrangeSchema = arrangeFramesInputSchema.extend(mutationScopeShape).strict();
export const annotateSchema = z
  .object({ ...annotateCanvasInputSchema.innerType().shape, ...mutationScopeShape })
  .strict();
export const inspectSchema = z
  .object({
    ...scopeShape,
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema.optional(),
    kind: z.enum(['diagnostics', 'element', 'screenshot']).default('diagnostics'),
    elementId: canvasIdentifierSchema.optional(),
  })
  .strict();
export const themeSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...scopeShape,
      operation: z.literal('list'),
      offset: pageSchema.default(0),
      limit: z.number().int().min(1).max(32).default(32),
    })
    .strict(),
  z.object({ ...scopeShape, operation: z.literal('read'), ref: designSystemRefSchema }).strict(),
  z
    .object({
      ...mutationScopeShape,
      operation: z.literal('save'),
      mutationId: canvasIdentifierSchema,
      ...kitSaveShape,
    })
    .strict(),
  z
    .object({
      ...mutationScopeShape,
      operation: z.literal('apply'),
      mutationId: canvasIdentifierSchema,
      designId: canvasIdentifierSchema,
      expectedRevisionId: canvasIdentifierSchema,
      ref: designSystemRefSchema,
    })
    .strict(),
]);
