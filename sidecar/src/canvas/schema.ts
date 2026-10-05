import { z } from 'zod';

// Product limits from the Canvas design specification §5. They are contracts,
// not defensive guesses, so the boundary is the single place they hold.
export const CANVAS_LIMITS = {
  maxFramesPerCreate: 4,
  maxFramesPerArrange: 256,
  maxSourceFilesPerDesign: 64,
  maxDesignSourceBytes: 1024 * 1024,
  maxFileBytes: 256 * 1024,
  maxFrameDimensionPx: 8192,
  maxIdentifierLength: 128,
  maxFrameNameLength: 120,
  maxSourcePathLength: 256,
} as const;

// Rejections reach the model and the user, so each message states the limit it
// enforces and names the recovery, never an internal detail.
const IDENTIFIER_MESSAGE = `A Canvas identifier is 1 to ${String(CANVAS_LIMITS.maxIdentifierLength)} characters of letters, digits, underscore or hyphen.`;
const FRAME_NAME_MESSAGE = `A frame name is 1 to ${String(CANVAS_LIMITS.maxFrameNameLength)} characters without control characters.`;
const COORDINATE_MESSAGE = 'Frame coordinates must be finite numbers.';
const DIMENSION_MESSAGE = `Frame width and height must be between 1 and ${String(CANVAS_LIMITS.maxFrameDimensionPx)} pixels.`;
const SOURCE_PATH_MESSAGE =
  'A source path must be relative, use forward slashes, and stay inside the design.';
const PATH_COLLISION_MESSAGE = 'Source paths must not repeat, ignoring case.';
const DELETED_AND_WRITTEN_MESSAGE = 'A deleted path cannot also be written in the same change.';
const FILE_COUNT_MESSAGE = `A design holds at most ${String(CANVAS_LIMITS.maxSourceFilesPerDesign)} source files.`;
const FILE_BYTES_MESSAGE = `Each source file must stay under ${String(CANVAS_LIMITS.maxFileBytes / 1024)} KiB.`;
const TOTAL_BYTES_MESSAGE = `The source written for one design must stay under ${String(CANVAS_LIMITS.maxDesignSourceBytes / (1024 * 1024))} MiB in total.`;
const FRAME_COUNT_MESSAGE = `One create reserves 1 to ${String(CANVAS_LIMITS.maxFramesPerCreate)} frames.`;
const ARRANGE_COUNT_MESSAGE = `One arrange moves 1 to ${String(CANVAS_LIMITS.maxFramesPerArrange)} frames.`;
const ARRANGE_REPEAT_MESSAGE = 'A frame can appear only once in an arrange.';

// Canvas IDs, design IDs, revision IDs and mutation IDs share one rule: an
// opaque token that is safe to log and can never widen a filesystem path.
export const canvasIdentifierSchema = z
  .string()
  .min(1, IDENTIFIER_MESSAGE)
  .max(CANVAS_LIMITS.maxIdentifierLength, IDENTIFIER_MESSAGE)
  .regex(/^[A-Za-z0-9_-]+$/, IDENTIFIER_MESSAGE);

const frameNameSchema = z
  .string()
  .trim()
  .min(1, FRAME_NAME_MESSAGE)
  .max(CANVAS_LIMITS.maxFrameNameLength, FRAME_NAME_MESSAGE)
  .refine((name) => !hasControlCharacter(name), { message: FRAME_NAME_MESSAGE });

const versionSchema = z.number().int().nonnegative();

export const designSystemRefSchema = z
  .object({
    id: canvasIdentifierSchema,
    version: versionSchema,
    mode: z.enum(['light', 'dark']),
  })
  .strict();

export const designRefSchema = z
  .object({
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema.nullable(),
  })
  .strict();

export const revisionRefSchema = z
  .object({
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
  })
  .strict();

export const canvasSeedSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('revision'),
      canvasId: canvasIdentifierSchema,
      revision: revisionRefSchema,
    })
    .strict(),
  z.object({ kind: z.literal('library'), itemId: canvasIdentifierSchema }).strict(),
]);

const coordinateSchema = z
  .number({ invalid_type_error: COORDINATE_MESSAGE })
  .finite(COORDINATE_MESSAGE);
const dimensionPxSchema = z
  .number({ invalid_type_error: DIMENSION_MESSAGE })
  .finite(DIMENSION_MESSAGE)
  .positive(DIMENSION_MESSAGE)
  .max(CANVAS_LIMITS.maxFrameDimensionPx, DIMENSION_MESSAGE);

export const frameRectSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: dimensionPxSchema,
    height: dimensionPxSchema,
  })
  .strict();

const sourcePathSchema = z.string().refine(isSafeSourcePath, { message: SOURCE_PATH_MESSAGE });

const sourceFileSchema = z
  .string()
  .refine((content) => Buffer.byteLength(content, 'utf8') <= CANVAS_LIMITS.maxFileBytes, {
    message: FILE_BYTES_MESSAGE,
  });

export const sourceFilesSchema = z
  .record(sourcePathSchema, sourceFileSchema)
  .refine((files) => Object.keys(files).length <= CANVAS_LIMITS.maxSourceFilesPerDesign, {
    message: FILE_COUNT_MESSAGE,
  })
  .refine((files) => !hasCaseCollision(Object.keys(files)), { message: PATH_COLLISION_MESSAGE })
  .refine((files) => totalSourceBytes(files) <= CANVAS_LIMITS.maxDesignSourceBytes, {
    message: TOTAL_BYTES_MESSAGE,
  });

const deletedPathsSchema = z
  .array(sourcePathSchema)
  .max(CANVAS_LIMITS.maxSourceFilesPerDesign, FILE_COUNT_MESSAGE)
  .refine((paths) => !hasCaseCollision(paths), { message: PATH_COLLISION_MESSAGE });

export const createFramesInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    frames: z
      .array(
        z
          .object({
            name: frameNameSchema,
            width: dimensionPxSchema,
            height: dimensionPxSchema,
            designSystem: designSystemRefSchema,
            seed: canvasSeedSchema.optional(),
          })
          .strict(),
      )
      .min(1, FRAME_COUNT_MESSAGE)
      .max(CANVAS_LIMITS.maxFramesPerCreate, FRAME_COUNT_MESSAGE),
  })
  .strict();

export const writeFilesInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    designId: canvasIdentifierSchema,
    expectedRevisionId: canvasIdentifierSchema.nullable(),
    files: sourceFilesSchema,
    deletedPaths: deletedPathsSchema,
    designSystem: designSystemRefSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const written = new Set(Object.keys(input.files).map((path) => path.toLowerCase()));
    input.deletedPaths.forEach((path, index) => {
      if (!written.has(path.toLowerCase())) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deletedPaths', index],
        message: DELETED_AND_WRITTEN_MESSAGE,
      });
    });
  });

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

export type DesignSystemRef = z.infer<typeof designSystemRefSchema>;
export type DesignRef = z.infer<typeof designRefSchema>;
export type RevisionRef = z.infer<typeof revisionRefSchema>;
export type CanvasSeed = z.infer<typeof canvasSeedSchema>;
export type FrameRect = z.infer<typeof frameRectSchema>;
export type SourceFiles = z.infer<typeof sourceFilesSchema>;
export type CreateFramesInput = z.infer<typeof createFramesInputSchema>;
export type WriteFilesInput = z.infer<typeof writeFilesInputSchema>;
export type ArrangeFramesInput = z.infer<typeof arrangeFramesInputSchema>;

// A source path addresses one design's virtual project, never the real
// filesystem, so nothing here may escape a single revision directory.
function isSafeSourcePath(path: string): boolean {
  if (path.length === 0 || path.length > CANVAS_LIMITS.maxSourcePathLength) return false;
  if (path.includes('\\') || hasControlCharacter(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

// Canvas storage sits on a case-insensitive filesystem, so paths differing only
// by case would collide inside one revision directory.
function hasCaseCollision(paths: readonly string[]): boolean {
  return hasDuplicate(paths.map((path) => path.toLowerCase()));
}

function totalSourceBytes(files: Record<string, string>): number {
  let bytes = 0;
  for (const content of Object.values(files)) bytes += Buffer.byteLength(content, 'utf8');
  return bytes;
}
