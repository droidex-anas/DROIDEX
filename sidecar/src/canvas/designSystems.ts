// Versioned executable design kits (spec §10). A kit is tokens, React
// primitives, guidance and examples; a revision pins one `id` and `version`, and
// that version never changes afterwards, so a saved design keeps compiling the
// way it was designed.

import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { canvasError, storageFailure } from './canvasError.js';
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

const designSystemSchema = z
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

const BUILT_IN_DESIGN_SYSTEMS: readonly DesignSystem[] = [DROIDEX_DESIGN_SYSTEM];

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
  const parsed = designSystemSchema.safeParse(parseJson(text));
  if (!parsed.success) throw canvasError('invalid_input', UNKNOWN_MESSAGE);
  // A file whose contents name another version would serve the wrong kit.
  if (parsed.data.id !== ref.id || parsed.data.version !== ref.version)
    throw canvasError('invalid_input', UNKNOWN_MESSAGE);
  return parsed.data;
}

/** Writes one new immutable version and returns the reference that pins it. */
export async function saveDesignSystem(system: DesignSystem): Promise<DesignSystemRef> {
  const parsed = designSystemSchema.safeParse(system);
  if (!parsed.success)
    throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? UNKNOWN_MESSAGE);
  const kit = parsed.data;
  if (BUILT_IN_DESIGN_SYSTEMS.some((builtIn) => builtIn.id === kit.id))
    throw canvasError('invalid_input', BUILT_IN_MESSAGE);

  const path = versionPath(kit.id, kit.version);
  if ((await readSavedText(path)) !== null) throw canvasError('invalid_input', IMMUTABLE_MESSAGE);
  await writeVersion(path, `${JSON.stringify(kit)}\n`);
  // A reference also names a mode; a saved kit has both, so the light one is
  // the selection a caller gets back until the user picks otherwise.
  return { id: kit.id, version: kit.version, mode: 'light' };
}

function versionPath(id: string, version: number): string {
  const parsed = canvasIdentifierSchema.safeParse(id);
  if (!parsed.success) throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? '');
  return join(canvasDir(), 'design-systems', parsed.data, `${String(version)}.json`);
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
 * A kit version becomes readable in one rename, so a reader never sees a
 * half-written kit. The existence check above plus the sidecar's single writer
 * are what keep a published version immutable.
 */
async function writeVersion(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  const temporary = `${path}.${String(process.pid)}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    const file = await open(temporary, CREATE_FLAGS, 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw storageFailure(SAVE_RECOVERY, error);
  }
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

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
