// Versioned executable design kits (spec §10). A kit is tokens, React
// primitives, guidance and examples; a revision pins one `id` and `version`, and
// that version never changes afterwards, so a saved design keeps compiling the
// way it was designed.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rm, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { canvasError, CanvasCommandError, storageFailure } from './canvasError.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import { canvasDir } from '../droidexPaths.js';
import type { DesignSystemRef } from './protocol.js';
import { canvasIdentifierSchema, sourceFilesSchema } from './schema.js';

/** The file a kit exports its primitives from, and the only entry it may have. */
export const KIT_ENTRY = 'index.tsx';

export const DESIGN_SYSTEM_LIMITS = {
  maxGuidanceBytes: 16 * 1024,
  maxNameLength: 120,
  maxTokensPerMode: 128,
  maxTokenValueLength: 160,
} as const;

const TOKEN_NAME_MESSAGE =
  'A design token is a CSS custom property such as --ds-accent: lowercase words separated by hyphens.';
const TOKEN_VALUE_MESSAGE =
  'A design token value is a single CSS value without a semicolon, brace or comment.';
const TOKEN_COUNT_MESSAGE = `Each mode declares at most ${String(DESIGN_SYSTEM_LIMITS.maxTokensPerMode)} tokens.`;
const GUIDANCE_MESSAGE = `Kit guidance must stay under ${String(DESIGN_SYSTEM_LIMITS.maxGuidanceBytes / 1024)} KiB.`;
const ENTRY_MESSAGE = `A design system must provide ${KIT_ENTRY}, which exports its primitives.`;
const UNKNOWN_MESSAGE = 'That design system version is not available.';
const BUILT_IN_MESSAGE = 'That design system name belongs to a built-in kit. Choose another id.';
const IMMUTABLE_MESSAGE =
  'That design system version is already saved. Save the change as the next version.';
const SAVE_RECOVERY = 'The design system could not be saved.';
const LINKED_STORAGE = 'Canvas storage holds a symbolic link and was not used.';

// A token value is pasted into a stylesheet, so it may not close the rule it
// sits in or open a comment.
const tokenValueSchema = z
  .string()
  .trim()
  .min(1, TOKEN_VALUE_MESSAGE)
  .max(DESIGN_SYSTEM_LIMITS.maxTokenValueLength, TOKEN_VALUE_MESSAGE)
  .refine((value) => !/[;{}<>]|\/\*/.test(value) && !/[\n\r\t]/.test(value), {
    message: TOKEN_VALUE_MESSAGE,
  });

const modeTokensSchema = z
  .record(z.string().regex(/^--[a-z0-9]+(-[a-z0-9]+)*$/, TOKEN_NAME_MESSAGE), tokenValueSchema)
  .refine((tokens) => Object.keys(tokens).length <= DESIGN_SYSTEM_LIMITS.maxTokensPerMode, {
    message: TOKEN_COUNT_MESSAGE,
  });

const kitFilesSchema = sourceFilesSchema.refine((files) => Object.hasOwn(files, KIT_ENTRY), {
  message: ENTRY_MESSAGE,
});

export const designSystemSchema = z
  .object({
    id: canvasIdentifierSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(DESIGN_SYSTEM_LIMITS.maxNameLength),
    modes: z.object({ light: modeTokensSchema, dark: modeTokensSchema }).strict(),
    files: kitFilesSchema,
    guidance: z
      .string()
      .refine((text) => Buffer.byteLength(text, 'utf8') <= DESIGN_SYSTEM_LIMITS.maxGuidanceBytes, {
        message: GUIDANCE_MESSAGE,
      }),
    examples: sourceFilesSchema,
  })
  .strict();

export type DesignSystem = z.infer<typeof designSystemSchema>;
const savedDesignSystemSchema = designSystemSchema.extend({
  mutationId: canvasIdentifierSchema.optional(),
});

const BUILT_IN_DESIGN_SYSTEMS: readonly DesignSystem[] = [DROIDEX_DESIGN_SYSTEM];

/** Summaries only; files and guidance are read when a specific version is requested. */
export async function listDesignSystems(): Promise<
  (Pick<DesignSystem, 'id' | 'version'> & { name?: string })[]
> {
  const summaries: (Pick<DesignSystem, 'id' | 'version'> & { name?: string })[] =
    BUILT_IN_DESIGN_SYSTEMS.map(({ id, version, name }) => ({ id, version, name }));
  let ids: string[];
  try {
    ids = await readdir(systemsRoot());
  } catch (error) {
    if (isMissing(error)) return summaries;
    throw storageFailure('Design systems could not be listed. Retry the read.', error);
  }
  for (const id of ids.sort()) {
    if (!canvasIdentifierSchema.safeParse(id).success) continue;
    await refuseLinkedPath(join(systemsRoot(), id));
    const versions = await readdir(join(systemsRoot(), id));
    for (const file of versions.sort()) {
      const version = Number(file.replace(/\.json$/, ''));
      if (!file.endsWith('.json') || !Number.isSafeInteger(version) || version < 1) continue;
      summaries.push({ id, version });
    }
  }
  return summaries;
}

/** The kit a new design starts from when nothing else is selected. */
export const DEFAULT_DESIGN_SYSTEM_REF: DesignSystemRef = {
  id: DROIDEX_DESIGN_SYSTEM.id,
  version: DROIDEX_DESIGN_SYSTEM.version,
  mode: 'dark',
};

/** Exactly the pinned version, from the built-in kits or the user's saved ones. */
export async function readDesignSystem(ref: DesignSystemRef): Promise<DesignSystem> {
  const builtIn = BUILT_IN_DESIGN_SYSTEMS.find(
    (system) => system.id === ref.id && system.version === ref.version,
  );
  if (builtIn) return builtIn;

  const text = await readSavedText(versionPath(ref.id, ref.version));
  if (text === null) throw canvasError('invalid_input', UNKNOWN_MESSAGE);
  const parsed = savedDesignSystemSchema.safeParse(parseJson(text));
  if (!parsed.success) throw canvasError('invalid_input', UNKNOWN_MESSAGE);
  const system = { ...parsed.data };
  delete system.mutationId;
  // A file whose contents name another version would serve the wrong kit.
  if (system.id !== ref.id || system.version !== ref.version)
    throw canvasError('invalid_input', UNKNOWN_MESSAGE);
  return system;
}

/** Writes one new immutable version and returns the reference that pins it. */
export async function saveDesignSystem(
  system: DesignSystem,
  options: { mutationId?: string; beforePublish?: () => void } = {},
): Promise<DesignSystemRef> {
  const parsed = designSystemSchema.safeParse(system);
  if (!parsed.success)
    throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? UNKNOWN_MESSAGE);
  const kit = parsed.data;
  if (BUILT_IN_DESIGN_SYSTEMS.some((builtIn) => builtIn.id === kit.id))
    throw canvasError('invalid_input', BUILT_IN_MESSAGE);

  const path = versionPath(kit.id, kit.version);
  try {
    await writeVersion(
      path,
      `${JSON.stringify({ ...kit, ...(options.mutationId ? { mutationId: options.mutationId } : {}) })}\n`,
      options.beforePublish ?? (() => undefined),
    );
  } catch (error) {
    if (!(error instanceof CanvasCommandError) || error.message !== IMMUTABLE_MESSAGE) throw error;
    if (!options.mutationId || !(await sameSavedMutation(path, options.mutationId, kit)))
      throw error;
  }
  // A reference also names a mode; a saved kit has both, so the light one is
  // the selection a caller gets back until the user picks otherwise.
  return { id: kit.id, version: kit.version, mode: 'light' };
}

async function sameSavedMutation(
  path: string,
  mutationId: string,
  kit: DesignSystem,
): Promise<boolean> {
  const text = await readSavedText(path);
  if (text === null) return false;
  const existing = savedDesignSystemSchema.safeParse(parseJson(text));
  if (!existing.success || existing.data.mutationId !== mutationId) return false;
  const saved = { ...existing.data };
  delete saved.mutationId;
  return isDeepStrictEqual(saved, kit);
}

function systemsRoot(): string {
  return join(canvasDir(), 'design-systems');
}

function versionPath(id: string, version: number): string {
  const parsed = canvasIdentifierSchema.safeParse(id);
  if (!parsed.success) throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? '');
  return join(systemsRoot(), parsed.data, `${String(version)}.json`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Canvas owns everything under its directory, so a link in the way is damage
// rather than a path to follow, exactly as canvasFiles.ts treats its own tree.
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const CREATE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

async function readSavedText(path: string): Promise<string | null> {
  let file;
  try {
    await refuseLinkedPath(path);
    file = await open(path, READ_FLAGS);
  } catch (error) {
    if (isMissing(error)) return null;
    throw storageFailure(UNKNOWN_MESSAGE, error);
  }
  try {
    return await file.readFile('utf8');
  } catch (error) {
    throw storageFailure(UNKNOWN_MESSAGE, error);
  } finally {
    await file.close();
  }
}

/**
 * A kit version becomes readable in one `link`, which refuses a destination
 * that already exists. That refusal is what makes a published version
 * immutable: a check followed by a rename would let two writers that both saw
 * nothing overwrite each other. The temporary is named per call, so concurrent
 * writers never collide on it either.
 */
async function writeVersion(
  path: string,
  content: string,
  beforePublish: () => void,
): Promise<void> {
  const directory = dirname(path);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await refuseLinkedPath(path);
    await mkdir(directory, { recursive: true });
    const file = await open(temporary, CREATE_FLAGS, 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    beforePublish();
    await link(temporary, path);
    await unlink(temporary);
    await flushAncestors(directory);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (isExisting(error)) throw canvasError('invalid_input', IMMUTABLE_MESSAGE);
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

/**
 * Flushes every directory entry this version rests on, whichever writer created
 * them. Flushing only what this save created would let one writer acknowledge a
 * version inside a directory another writer has not flushed yet, and a crash
 * would lose it. A flush of an already durable directory costs almost nothing,
 * so each save pays for its whole chain and its acknowledgement stands alone.
 */
async function flushAncestors(leaf: string): Promise<void> {
  const root = canvasDir();
  // The storage root's own entry belongs to the user's profile, which may
  // legitimately be a link; everything below it is Canvas's own.
  const chain = [dirname(root), root];
  let current = root;
  for (const segment of relative(root, leaf).split(sep)) {
    if (segment === '') break;
    current = join(current, segment);
    chain.push(current);
  }
  for (const path of chain) await syncDirectory(path);
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Refuses a path that crosses a symbolic link anywhere below the design-system
 * root. `O_NOFOLLOW` guards only the final component, so a linked kit directory
 * would otherwise let a read or a write land outside Canvas storage.
 */
async function refuseLinkedPath(path: string): Promise<void> {
  const root = systemsRoot();
  let current = root;
  for (const segment of relative(root, path).split(sep)) {
    const stats = await lstatIfPresent(current);
    // Nothing exists below a component that is not there.
    if (!stats) return;
    if (stats.isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
    current = join(current, segment);
  }
}

async function lstatIfPresent(path: string): Promise<{ isSymbolicLink(): boolean } | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

function isExisting(error: unknown): boolean {
  return hasCode(error, 'EEXIST');
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
