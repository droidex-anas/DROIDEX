// The inputs of the edits the board makes to frames themselves, rather than to
// their source: placing, removing, restoring, naming, hiding and stacking.
// CanvasFrameEdits applies them.

import { z } from 'zod';
import {
  CANVAS_LIMITS,
  canvasIdentifierSchema,
  canvasNameSchema,
  frameRectSchema,
  hasDuplicate,
  versionSchema,
} from './schema.js';

const ARRANGE_COUNT_MESSAGE = `One arrange moves 1 to ${String(CANVAS_LIMITS.maxFramesPerArrange)} frames.`;
const ARRANGE_REPEAT_MESSAGE = 'A frame can appear only once in an arrange.';
export const arrangeFramesInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    frames: z
      .array(
        z
          .object({
            designId: canvasIdentifierSchema,
            expectedLayoutVersion: versionSchema,
            rect: frameRectSchema,
          })
          .strict(),
      )
      .min(1, ARRANGE_COUNT_MESSAGE)
      .max(CANVAS_LIMITS.maxFramesPerArrange, ARRANGE_COUNT_MESSAGE)
      // Two entries for one frame would carry contradictory expected versions.
      .refine((frames) => !hasDuplicate(frames.map((frame) => frame.designId)), {
        message: ARRANGE_REPEAT_MESSAGE,
      }),
  })
  .strict();

export const removeFramesInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    designIds: z
      .array(canvasIdentifierSchema)
      .min(1)
      .max(CANVAS_LIMITS.maxFramesPerRemoval)
      .refine((ids) => !hasDuplicate(ids), {
        message: 'A frame can be removed only once per change.',
      }),
  })
  .strict();

export const undoRemovalInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    undoId: canvasIdentifierSchema,
  })
  .strict();

export const renameFrameInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    designId: canvasIdentifierSchema,
    name: canvasNameSchema,
    expectedManifestVersion: versionSchema,
  })
  .strict();

export const setFrameHiddenInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    designId: canvasIdentifierSchema,
    hidden: z.boolean(),
    expectedManifestVersion: versionSchema,
  })
  .strict();

// The whole stacking order, back to front. Whether it names exactly the
// canvas's frames is a question for the head it commits on, not for this shape.
export const reorderFramesInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    designIds: z
      .array(canvasIdentifierSchema)
      .min(1)
      .refine((ids) => !hasDuplicate(ids), { message: 'A reorder names each frame once.' }),
  })
  .strict();

export type ArrangeFramesInput = z.infer<typeof arrangeFramesInputSchema>;
export type RemoveFramesInput = z.infer<typeof removeFramesInputSchema>;
export type UndoRemovalInput = z.infer<typeof undoRemovalInputSchema>;
export type RenameFrameInput = z.infer<typeof renameFrameInputSchema>;
export type SetFrameHiddenInput = z.infer<typeof setFrameHiddenInputSchema>;
export type ReorderFramesInput = z.infer<typeof reorderFramesInputSchema>;
