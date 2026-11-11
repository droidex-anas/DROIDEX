// The input of an edit the pane makes inside a design's source: an element's
// text, styles or image, or a layer of its outline. canvasElementEdit applies it.

import { z } from 'zod';
import {
  CANVAS_LIMITS,
  canvasIdentifierSchema,
  hasDuplicate,
  outlineNodeIdSchema,
  revisionRefSchema,
  sourceFileSchema,
} from './schema.js';

const STYLE_COUNT_MESSAGE = `One edit sets 1 to ${String(CANVAS_LIMITS.maxStylesPerEdit)} styles.`;
const STYLE_REPEAT_MESSAGE = 'A style property can appear only once in an edit.';

// A style's value is a kit token's name (`--ds-space-2`) or a raw CSS value,
// which the edit resolves to a kit token with that value when the kit has one.
const styleSchema = z
  .object({ property: z.string().min(1).max(64), value: z.string().min(1).max(128) })
  .strict();

export const editElementInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    edit: z.union([
      z
        .object({
          element: revisionRefSchema.extend({
            elementId: canvasIdentifierSchema,
            instancePath: z.string().max(512),
          }),
          change: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('text'), value: sourceFileSchema }).strict(),
            z
              .object({
                kind: z.literal('style'),
                styles: z
                  .array(styleSchema)
                  .min(1, STYLE_COUNT_MESSAGE)
                  .max(CANVAS_LIMITS.maxStylesPerEdit, STYLE_COUNT_MESSAGE)
                  // Two values for one property would contradict each other.
                  .refine((styles) => !hasDuplicate(styles.map((style) => style.property)), {
                    message: STYLE_REPEAT_MESSAGE,
                  }),
              })
              .strict(),
            z.object({ kind: z.literal('image'), assetId: canvasIdentifierSchema }).strict(),
          ]),
        })
        .strict(),
      // A layer is a row of the revision's outline, as its nodeId names it.
      z
        .object({
          layer: revisionRefSchema.extend({ nodeId: outlineNodeIdSchema }),
          change: z
            .object({
              kind: z.literal('move'),
              parentId: outlineNodeIdSchema,
              beforeId: outlineNodeIdSchema.nullable(),
            })
            .strict(),
        })
        .strict(),
    ]),
  })
  .strict();

export type EditElementInput = z.infer<typeof editElementInputSchema>;
