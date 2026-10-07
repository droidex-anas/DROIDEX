import { z } from 'zod';

// Product limits from the Canvas design specification §5. They are contracts,
// not defensive guesses, so the boundary is the single place they hold.
export const CANVAS_LIMITS = {
  maxFramesPerCreate: 4,
  maxFramesPerArrange: 256,
  maxFramesPerRemoval: 256,
  maxSourceFilesPerDesign: 64,
  maxDesignSourceBytes: 1024 * 1024,
  maxFileBytes: 256 * 1024,
  maxFrameDimensionPx: 8192,
  maxIdentifierLength: 128,
  maxFrameNameLength: 120,
  maxSourcePathLength: 256,
  /** Spec §5: two compiler jobs run at once, across every open canvas. */
  buildSlots: 2,
  /** Spec §5: one build gets this long before its worker is ended. */
  buildDeadlineMs: 15_000,
} as const;

// Rejections reach the model and the user, so each message states the limit it
// enforces and names the recovery, never an internal detail.
const IDENTIFIER_MESSAGE = `A Canvas identifier is 1 to ${String(CANVAS_LIMITS.maxIdentifierLength)} characters of letters, digits, underscore or hyphen.`;
const FRAME_NAME_MESSAGE = `A frame name is 1 to ${String(CANVAS_LIMITS.maxFrameNameLength)} characters without control characters.`;
const COORDINATE_MESSAGE = 'Frame coordinates must be finite numbers.';
const DIMENSION_MESSAGE = `Frame width and height must be between 1 and ${String(CANVAS_LIMITS.maxFrameDimensionPx)} pixels.`;
const SOURCE_PATH_MESSAGE =
  'A source path must be relative, use forward slashes, and stay inside the design.';
const RESERVED_PATH_MESSAGE =
  'A source path cannot use the segment __proto__, constructor or prototype.';
const PATH_COLLISION_MESSAGE =
  'Source paths and their folders must be distinct, ignoring case and Unicode normalization, and one name cannot be both a file and a folder.';
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

export const frameNameSchema = z
  .string()
  .refine((name) => !hasControlCharacter(name), { message: FRAME_NAME_MESSAGE })
  .pipe(
    z
      .string()
      .trim()
      .min(1, FRAME_NAME_MESSAGE)
      .max(CANVAS_LIMITS.maxFrameNameLength, FRAME_NAME_MESSAGE),
  );

const versionSchema = z.number().int().nonnegative();

export const designSystemRefSchema = z
  .object({
    id: canvasIdentifierSchema,
    version: versionSchema,
    mode: z.enum(['light', 'dark']),
  })
  .strict();

const revisionRefSchema = z
  .object({
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
  })
  .strict();

const canvasSeedSchema = z.discriminatedUnion('kind', [
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

// The reserved-segment rule runs on the record's keys, so an unusable path is
// rejected before Zod builds the output object and loses the file. Exported
// because persisted revision metadata maps paths to disk and may never trust a
// path it did not re-validate.
export const sourcePathSchema = z
  .string()
  .refine(isSafeSourcePath, { message: SOURCE_PATH_MESSAGE })
  .refine(hasNoReservedSegment, { message: RESERVED_PATH_MESSAGE });

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
  .refine((files) => !hasPathCollision(Object.keys(files)), { message: PATH_COLLISION_MESSAGE })
  .refine((files) => totalSourceBytes(Object.values(files)) <= CANVAS_LIMITS.maxDesignSourceBytes, {
    message: TOTAL_BYTES_MESSAGE,
  });

const deletedPathsSchema = z
  .array(sourcePathSchema)
  .max(CANVAS_LIMITS.maxSourceFilesPerDesign, FILE_COUNT_MESSAGE)
  .refine((paths) => !hasPathCollision(paths), { message: PATH_COLLISION_MESSAGE });

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
    const written = new Set(Object.keys(input.files).map(collisionKey));
    input.deletedPaths.forEach((path, index) => {
      if (!written.has(collisionKey(path))) return;
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
    name: frameNameSchema,
    expectedManifestVersion: versionSchema,
  })
  .strict();

// One write is bounded by the schema above; the revision it produces carries
// unchanged files too, so the same §5 limits are checked against the merge.
// Returns the limit's own message, or null when the revision fits.
export function mergedRevisionViolation(files: ReadonlyMap<string, string>): string | null {
  if (files.size > CANVAS_LIMITS.maxSourceFilesPerDesign) return FILE_COUNT_MESSAGE;
  if (hasPathCollision([...files.keys()])) return PATH_COLLISION_MESSAGE;
  const bytes = totalSourceBytes(files.values());
  return bytes > CANVAS_LIMITS.maxDesignSourceBytes ? TOTAL_BYTES_MESSAGE : null;
}

export type DesignSystemRef = z.infer<typeof designSystemRefSchema>;
export interface DesignRef {
  designId: string;
  revisionId: string | null;
}
export type RevisionRef = z.infer<typeof revisionRefSchema>;
export type FrameRect = z.infer<typeof frameRectSchema>;
export type SourceFiles = z.infer<typeof sourceFilesSchema>;
export type CreateFramesInput = z.infer<typeof createFramesInputSchema>;
export type WriteFilesInput = z.infer<typeof writeFilesInputSchema>;
export type ArrangeFramesInput = z.infer<typeof arrangeFramesInputSchema>;
export type RemoveFramesInput = z.infer<typeof removeFramesInputSchema>;
export type UndoRemovalInput = z.infer<typeof undoRemovalInputSchema>;
export type RenameFrameInput = z.infer<typeof renameFrameInputSchema>;

// An unpaired surrogate encodes to the same UTF-8 replacement bytes as any
// other, so two distinct paths would address one file on disk.
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

// A source path addresses one design's virtual project, never the real
// filesystem, so nothing here may escape a single revision directory.
function isSafeSourcePath(path: string): boolean {
  if (path.length === 0 || path.length > CANVAS_LIMITS.maxSourcePathLength) return false;
  if (path.includes('\\') || hasControlCharacter(path)) return false;
  if (UNPAIRED_SURROGATE.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// An object-keyed source tree silently drops a `__proto__` key and shadows
// inherited members with the other two, so no segment may be one of them.
function hasNoReservedSegment(path: string): boolean {
  return !path.split('/').some((segment) => RESERVED_PATH_SEGMENTS.has(segment));
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

// Folders collide the same way files do: `ui/A.tsx` and `UI/B.tsx` are two
// paths for one directory on the filesystems Canvas storage sits on, and a name
// cannot be both a file and a folder. Each folded key must name one entry.
function hasPathCollision(paths: readonly string[]): boolean {
  if (hasDuplicate(paths.map(collisionKey))) return true;
  const entries = new Map<string, string>();
  for (const path of paths) {
    const segments = path.split('/');
    let key = '';
    let entry = '';
    for (const [index, segment] of segments.entries()) {
      key = key === '' ? collisionKey(segment) : `${key}/${collisionKey(segment)}`;
      entry = entry === '' ? segment : `${entry}/${segment}`;
      const kind = index === segments.length - 1 ? 'file' : 'folder';
      const named = `${kind} ${entry}`;
      const existing = entries.get(key);
      if (existing !== undefined && existing !== named) return true;
      entries.set(key, named);
    }
  }
  return false;
}

// Canvas storage sits on a filesystem that compares names without case and
// without Unicode form, so both are folded away before comparing paths.
function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function totalSourceBytes(contents: Iterable<string>): number {
  let bytes = 0;
  for (const content of contents) bytes += Buffer.byteLength(content, 'utf8');
  return bytes;
}
