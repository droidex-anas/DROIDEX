// The argument schemas of the canvas MCP tools. A mutation needs the scopeId
// its turn's canvas_read returned; a read may omit it to use the active turn.

import { z } from 'zod';
import { kitSaveShape } from './canvasMcpDesignSystemSave.js';
import { annotateCanvasInputSchema } from './canvasAnnotationSchema.js';
import { arrangeFramesInputSchema } from './frameEditSchema.js';
import { MAX_PROJECT_PATH_LENGTH } from './projectPaths.js';
import {
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
const scopeShape = {
  scopeId: scopeIdSchema
    .optional()
    .describe(
      'Omit scopeId to begin the turn. Only supply a scopeId this turn’s canvas_read returned to keep reading that lease’s pinned references.',
    ),
};
const mutationScopeShape = { scopeId: scopeIdSchema };
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
const projectPathSchema = z.string().min(1).max(MAX_PROJECT_PATH_LENGTH);
const scaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
/** canvas_image's arguments as MCP lists them; `imageSchema` holds each kind to its own. */
export const imageShape = {
  ...mutationScopeShape,
  kind: z.enum(['render', 'import']),
  designId: canvasIdentifierSchema.optional(),
  format: z.enum(['png', 'svg']).optional(),
  scale: scaleSchema.optional().describe('PNG pixels per CSS pixel; 1 is the frame’s own size.'),
  to: projectPathSchema
    .optional()
    .describe('For render: the file to write, relative to the project folder.'),
  overwrite: z.boolean().optional(),
  from: projectPathSchema
    .optional()
    .describe('For import: the image to import, relative to the project folder.'),
};
export const imageSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...mutationScopeShape,
      kind: z.literal('render'),
      designId: canvasIdentifierSchema,
      format: z.enum(['png', 'svg']).default('png'),
      scale: scaleSchema.default(1),
      to: projectPathSchema,
      overwrite: z.boolean().default(false),
    })
    .strict(),
  z.object({ ...mutationScopeShape, kind: z.literal('import'), from: projectPathSchema }).strict(),
]);
