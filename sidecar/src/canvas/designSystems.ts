// Versioned executable design kits (spec §10). A kit version is a document
// (design system documents spec §2) with React primitives and the examples its
// previews render; a revision pins one `id` and `version`, and that version
// never changes afterwards, so a saved design keeps compiling the way it was
// designed.

import { readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { canvasError, staleDesignSystemBase, storageFailure } from './canvasError.js';
import { AUTO_DESIGN_SYSTEM } from './presets/auto.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';
import { CLAUDE_INSPIRED_DESIGN_SYSTEM } from './presets/claude-inspired.js';
import { DROIDEX_KIT } from './presets/droidexKit.js';
import { announceDesignSystemChange } from './designSystemChanges.js';
import { convertLegacyVersion, legacySummary } from './designSystemConversion.js';
import {
  DOCUMENT_LIMITS,
  documentSectionsSchema,
  kitModes,
  largestNote,
  tokenValueSchema,
  withNoteAuthors,
  writtenTextBytes,
} from './designSystemDocument.js';
import {
  exists,
  flushAncestors,
  isMissing,
  LINKED_STORAGE,
  proposalPath,
  readSavedFile,
  refuseLinkedPath,
  savedVersions,
  setTombstone,
  systemsRoot,
  tombstonePath,
  versionPath,
  writeVersion,
} from './designSystemStorage.js';
import { refuseUnknownKitAssets } from './kitAssets.js';
import type { DesignSystemRef, DesignSystemVersionRef } from './protocol.js';
import {
  canvasIdentifierSchema,
  designSystemVersionRefSchema,
  sourceFilesSchema,
  sourcePathSchema,
} from './schema.js';

/** The file a kit exports its primitives from, and the only entry it may have. */
export const KIT_ENTRY = 'index.tsx';

export const DESIGN_SYSTEM_LIMITS = {
  maxGuidanceBytes: 16 * 1024,
  maxNameLength: 120,
  maxProjectFiles: 8,
  maxProjectPathLength: 1024,
} as const;

const ENTRY_MESSAGE = `A design system must provide ${KIT_ENTRY}, which exports its primitives.`;
const UNKNOWN_MESSAGE = 'That design system version is not available.';
const BUILT_IN_MESSAGE = 'That design system name belongs to a built-in kit. Choose another id.';
const DELETED_MESSAGE = 'That design system was deleted. Restore it before saving to it.';

const kitFilesSchema = sourceFilesSchema.refine((files) => Object.hasOwn(files, KIT_ENTRY), {
  message: ENTRY_MESSAGE,
});

const coverSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('preview'), example: sourcePathSchema }).strict(),
    z.object({ kind: z.literal('image'), assetId: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  ])
  .nullable();

const designSystemObjectSchema = z
  .object({
    id: canvasIdentifierSchema,
    version: z.number().int().positive().safe(),
    name: z.string().trim().min(1).max(DESIGN_SYSTEM_LIMITS.maxNameLength),
    cover: coverSchema,
    sections: documentSectionsSchema,
    files: kitFilesSchema,
    examples: sourceFilesSchema,
    // Extracted from a canvas revision, saved as a copy of another kit version,
    // or read from a project folder's files.
    provenance: z
      .union([
        z
          .object({
            sourceCanvasId: canvasIdentifierSchema,
            revision: z
              .object({ designId: canvasIdentifierSchema, revisionId: canvasIdentifierSchema })
              .strict(),
          })
          .strict(),
        z.object({ copiedFrom: designSystemVersionRefSchema }).strict(),
        z
          .object({
            project: z
              .object({
                name: z.string().min(1).max(255),
                files: z
                  .array(z.string().min(1).max(DESIGN_SYSTEM_LIMITS.maxProjectPathLength))
                  .min(1)
                  .max(DESIGN_SYSTEM_LIMITS.maxProjectFiles),
              })
              .strict(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

export const designSystemSchema = designSystemObjectSchema.superRefine((system, context) => {
  const problem = versionProblem(system);
  if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

export type DesignSystem = z.infer<typeof designSystemSchema>;
type DesignSystemProvenance = NonNullable<DesignSystem['provenance']>;
export type DesignSystemCover = DesignSystem['cover'];

// The rules that span the document and its files.
function versionProblem(system: z.infer<typeof designSystemObjectSchema>): string | null {
  const examples = system.sections.flatMap((section) =>
    section.items.flatMap((item) => (item.kind === 'preview' ? [item.example] : [])),
  );
  if (system.cover?.kind === 'preview') examples.push(system.cover.example);
  const missing = examples.find((example) => !Object.hasOwn(system.examples, example));
  if (missing !== undefined) return `No example ${missing} exists. Add it or name another one.`;
  if (examples.length > DOCUMENT_LIMITS.maxPreviews)
    return `A design system has at most ${String(DOCUMENT_LIMITS.maxPreviews)} previews, its cover included.`;
  if (writtenTextBytes(system.sections) > DESIGN_SYSTEM_LIMITS.maxGuidanceBytes)
    return `The design system's text is over 16 KiB. Shorten its notes, starting with ${largestNote(system.sections) ?? 'the longest'}.`;
  const documentBytes = Buffer.byteLength(
    JSON.stringify({ ...system, files: undefined, examples: undefined }),
    'utf8',
  );
  if (documentBytes > DOCUMENT_LIMITS.maxDocumentBytes)
    return 'The design system document is over 256 KiB. Remove some of it.';
  return null;
}

const savedBySchema = z.discriminatedUnion('actor', [
  z.object({ actor: z.literal('user') }).strict(),
  z.object({ actor: z.literal('agent'), appSessionId: z.string().min(1).max(200) }).strict(),
]);
export type SavedBy = z.infer<typeof savedBySchema>;

const swatchesSchema = z.object({ surface: tokenValueSchema, accent: tokenValueSchema }).strict();
// The first line of every saved version: what lists and the version history read.
const headerSchema = z
  .object({
    id: canvasIdentifierSchema,
    version: z.number().int().positive().safe(),
    name: z.string().min(1).max(DESIGN_SYSTEM_LIMITS.maxNameLength),
    swatches: z.object({ light: swatchesSchema, dark: swatchesSchema }).strict(),
    cover: z.boolean(),
    savedAt: z.string().datetime(),
    savedBy: savedBySchema,
  })
  .strict();
type VersionHeader = z.infer<typeof headerSchema>;

/** A row of the design-system list: Auto, the presets, then each user kit's latest version. */
export interface DesignSystemSummary {
  id: string;
  version: number;
  name: string;
  kind: 'auto' | 'preset' | 'user';
  swatches: VersionHeader['swatches'];
  cover: boolean;
  /** When the listed version was saved; a built-in kit was never saved. */
  savedAt: string | null;
  /** Whether an agent proposal waits for review. */
  proposal: boolean;
}

/** One saved version as the version history lists it. */
export interface DesignSystemVersionEntry {
  version: number;
  savedAt: string;
  savedBy: SavedBy;
}

/** A new kit's source from the New menu. */
export interface DesignSystemSource {
  kind: 'designMd' | 'cssOrTailwind';
  text: string;
}

export type { DesignSystemProvenance };

const savedVersionSchema = z
  .object({
    summary: headerSchema,
    system: designSystemSchema,
    mutationId: canvasIdentifierSchema.optional(),
  })
  .strict();
const HEADER_BYTES = 8192;

// Parsing snapshots the authored and exported kits and validates their limits at startup.
const BUILT_IN_DESIGN_SYSTEMS: readonly DesignSystem[] = [
  AUTO_DESIGN_SYSTEM,
  DROIDEX_KIT,
  OPENAI_INSPIRED_DESIGN_SYSTEM,
  CLAUDE_INSPIRED_DESIGN_SYSTEM,
].map((system) => designSystemSchema.parse(system));

/**
 * What a request runs under when the user chose no kit and pinned no frame:
 * the agent takes the style from the prompt and the canvas instead.
 */
export const AUTO_DESIGN_SYSTEM_REF: DesignSystemRef = {
  id: AUTO_DESIGN_SYSTEM.id,
  version: AUTO_DESIGN_SYSTEM.version,
  mode: 'light',
};

export function designSystemKind(id: string): DesignSystemSummary['kind'] {
  if (id === AUTO_DESIGN_SYSTEM.id) return 'auto';
  return BUILT_IN_DESIGN_SYSTEMS.some((system) => system.id === id) ? 'preset' : 'user';
}

/**
 * Auto, the presets, then the latest published version of each user kit that
 * is not deleted; reads only headers. A kit whose header is damaged is left out
 * and logged, so one bad kit never hides the others.
 */
export async function listDesignSystems(): Promise<DesignSystemSummary[]> {
  const summaries: DesignSystemSummary[] = BUILT_IN_DESIGN_SYSTEMS.map((system) => ({
    ...documentHeader(system),
    kind: designSystemKind(system.id),
    savedAt: null,
    proposal: false,
  }));
  const root = systemsRoot();
  try {
    await refuseLinkedPath(root);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
      if (!entry.isDirectory()) continue;
      const id = canvasIdentifierSchema.safeParse(entry.name);
      if (!id.success || (await exists(tombstonePath(id.data)))) continue;
      const versions = await savedVersions(id.data);
      if (versions.length === 0) continue;
      const header = await readHeader(id.data, Math.max(...versions));
      if (!header) continue;
      const { version, name, swatches, cover, savedAt } = header;
      summaries.push({
        id: id.data,
        version,
        name,
        kind: 'user',
        swatches,
        cover,
        savedAt,
        proposal: await exists(proposalPath(id.data)),
      });
    }
    return summaries;
  } catch (error) {
    if (isMissing(error)) return summaries;
    throw storageFailure(
      'Design systems could not be listed. Restore the saved kits and retry.',
      error,
    );
  }
}

/** A user kit's saved versions, newest first; built-in kits have none. */
export async function listDesignSystemVersions(id: string): Promise<DesignSystemVersionEntry[]> {
  if (designSystemKind(id) !== 'user') return [];
  const entries: DesignSystemVersionEntry[] = [];
  for (const version of (await savedVersions(id)).sort((a, b) => b - a)) {
    const header = await readHeader(id, version);
    if (header) entries.push({ version, savedAt: header.savedAt, savedBy: header.savedBy });
  }
  return entries;
}

async function readHeader(id: string, version: number): Promise<VersionHeader | null> {
  const saved = await readSavedFile(versionPath(id, version), HEADER_BYTES);
  if (saved === null) return null; // A concurrent save has not published its version yet.
  const newline = saved.text.indexOf('\n');
  if (newline < 0 || !saved.text.startsWith('{"summary":'))
    return skipDamagedKit(id, version, 'its file does not start with a saved kit header');
  const value = parseJson(saved.text.slice('{"summary":'.length, newline - 1));
  const header = headerSchema.safeParse(value).data ?? convertLegacyHeader(value, saved.modifiedAt);
  if (header?.id !== id || header.version !== version)
    return skipDamagedKit(id, version, 'its header does not describe that saved version');
  return header;
}

// v1.6 recorded neither when nor by whom; its kits were the user's.
function convertLegacyHeader(value: unknown, modifiedAt: Date): VersionHeader | null {
  const legacy = legacySummary(value);
  if (!legacy) return null;
  const { id, version, name, swatches } = legacy;
  const savedAt = modifiedAt.toISOString();
  return { id, version, name, swatches, cover: false, savedAt, savedBy: { actor: 'user' } };
}

// The picker lists on every open, so each damaged file is logged once.
const reportedDamagedKits = new Set<string>();

function skipDamagedKit(id: string, version: number, reason: string): null {
  const path = versionPath(id, version);
  if (reportedDamagedKits.has(path)) return null;
  reportedDamagedKits.add(path);
  console.warn(
    `Design system ${id} version ${String(version)} was not listed because ${reason}. Restore or remove ${path}.`,
  );
  return null;
}

/**
 * Exactly the pinned version, from the built-in kits or the user's saved ones,
 * deleted or not. A design's reference also names its preview mode, which
 * selects nothing here.
 */
export async function readDesignSystem(
  ref: DesignSystemRef | DesignSystemVersionRef,
): Promise<DesignSystem> {
  const builtIn = BUILT_IN_DESIGN_SYSTEMS.find(
    (system) => system.id === ref.id && system.version === ref.version,
  );
  if (builtIn) return structuredClone(builtIn);
  if (designSystemKind(ref.id) !== 'user') throw canvasError('version_mismatch', UNKNOWN_MESSAGE);

  const saved = await readSavedFile(versionPath(ref.id, ref.version));
  if (saved === null) throw canvasError('version_mismatch', UNKNOWN_MESSAGE);
  const value = parseJson(saved.text);
  const system = savedSystem(value) ?? convertLegacyVersion(value);
  if (!system)
    throw canvasError(
      'storage_failed',
      'The saved kit is damaged. Restore that design system version.',
    );
  // A file whose contents name another version would serve the wrong kit.
  if (system.id !== ref.id || system.version !== ref.version)
    throw canvasError(
      'storage_failed',
      'The saved kit metadata disagrees with its content. Restore that version.',
    );
  return system;
}

/** The kit a current version file holds, when its header describes it. */
function savedSystem(value: unknown): DesignSystem | null {
  const parsed = savedVersionSchema.safeParse(value);
  if (!parsed.success) return null;
  const { summary, system } = parsed.data;
  const described = {
    ...documentHeader(system),
    savedAt: summary.savedAt,
    savedBy: summary.savedBy,
  };
  return isDeepStrictEqual(summary, described) ? system : null;
}

/**
 * Writes the version after `baseVersion` (`null` for a new kit's first) and
 * returns the reference that pins it. Each note the saver changed against the
 * base becomes theirs (§2). A retry with the same mutation ID and kit answers
 * with the version it already wrote; any other save onto a base that is no
 * longer the latest is refused and writes nothing.
 */
export async function saveDesignSystem(
  system: Omit<DesignSystem, 'version'>,
  options: {
    mutationId: string;
    baseVersion: number | null;
    savedBy: SavedBy;
    beforePublish?: () => void;
  },
): Promise<DesignSystemRef> {
  const parsed = designSystemSchema.safeParse({
    ...system,
    version: (options.baseVersion ?? 0) + 1,
  });
  if (!parsed.success)
    throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? UNKNOWN_MESSAGE);
  if (designSystemKind(parsed.data.id) !== 'user')
    throw canvasError('preset_read_only', BUILT_IN_MESSAGE);
  const { baseVersion, savedBy } = options;
  const base =
    baseVersion === null
      ? []
      : (await readDesignSystem({ id: system.id, version: baseVersion })).sections;
  const kit = {
    ...parsed.data,
    sections: withNoteAuthors(parsed.data.sections, base, savedBy.actor),
  };

  const path = versionPath(kit.id, kit.version);
  if (!(await isSavedMutation(path, options.mutationId, kit))) {
    await refuseDeleted(kit.id);
    await refuseUnknownKitAssets(kit);
    await refuseStaleBase(kit.id, baseVersion);
    const header: VersionHeader = {
      ...documentHeader(kit),
      savedAt: new Date().toISOString(),
      savedBy,
    };
    // The header and executable content publish together in one immutable version.
    const outcome = await writeVersion(
      path,
      `{"summary":${JSON.stringify(header)},\n"system":${JSON.stringify(kit)},"mutationId":${JSON.stringify(options.mutationId)}}\n`,
      options.beforePublish ?? (() => undefined),
    );
    if (outcome === 'exists' && !(await isSavedMutation(path, options.mutationId, kit)))
      throw staleDesignSystemBase(await latestVersion(kit.id));
  }
  try {
    await flushAncestors(dirname(path));
  } catch (error) {
    throw storageFailure('The design system could not be saved.', error);
  }
  announceDesignSystemChange(kit.id);
  // A reference also names a mode; a saved kit has both, so the light one is
  // the selection a caller gets back until the user picks otherwise.
  return { id: kit.id, version: kit.version, mode: 'light' };
}

export async function refuseDeleted(id: string): Promise<void> {
  if (await exists(tombstonePath(id))) throw canvasError('invalid_input', DELETED_MESSAGE);
}

export async function refuseStaleBase(id: string, baseVersion: number | null): Promise<void> {
  const latest = await latestVersion(id);
  if (latest === (baseVersion ?? 0)) return;
  if (latest === 0) throw canvasError('version_mismatch', UNKNOWN_MESSAGE);
  throw staleDesignSystemBase(latest);
}

async function latestVersion(id: string): Promise<number> {
  return Math.max(0, ...(await savedVersions(id)));
}

/** Whether this mutation wrote that version, so a retry can answer with it. */
export async function wasSavedBy(
  ref: DesignSystemVersionRef,
  mutationId: string,
): Promise<boolean> {
  const saved = await readSavedFile(versionPath(ref.id, ref.version));
  if (saved === null) return false;
  return savedVersionSchema.safeParse(parseJson(saved.text)).data?.mutationId === mutationId;
}

async function isSavedMutation(
  path: string,
  mutationId: string,
  kit: DesignSystem,
): Promise<boolean> {
  const saved = await readSavedFile(path);
  if (saved === null) return false;
  const existing = savedVersionSchema.safeParse(parseJson(saved.text));
  return (
    existing.success &&
    existing.data.mutationId === mutationId &&
    isDeepStrictEqual(existing.data.system, kit)
  );
}

/** Takes a user kit out of every list, or puts it back; pinned versions still build. A
 * mutation that already ran is not rerun, so a delete retried after Undo changes nothing. */
export async function setDesignSystemDeleted(
  id: string,
  deleted: boolean,
  mutationId: string,
): Promise<void> {
  if (designSystemKind(id) !== 'user') throw canvasError('preset_read_only', BUILT_IN_MESSAGE);
  if ((await latestVersion(id)) === 0) throw canvasError('version_mismatch', UNKNOWN_MESSAGE);
  await setTombstone(id, deleted, mutationId);
  announceDesignSystemChange(id);
}

/** What a version's header says about its document. */
function documentHeader(
  system: DesignSystem,
): Pick<VersionHeader, 'id' | 'version' | 'name' | 'swatches' | 'cover'> {
  const modes = kitModes(system.sections);
  const swatches = (tokens: Record<string, string>) => {
    let surface = 'transparent';
    if (Object.hasOwn(tokens, '--ds-surface')) surface = tokens['--ds-surface'];
    else if (Object.hasOwn(tokens, '--ds-canvas')) surface = tokens['--ds-canvas'];
    const accent = Object.hasOwn(tokens, '--ds-accent') ? tokens['--ds-accent'] : 'transparent';
    return { surface, accent };
  };
  return {
    id: system.id,
    version: system.version,
    name: system.name,
    swatches: { light: swatches(modes.light), dark: swatches(modes.dark) },
    cover: system.cover !== null,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
