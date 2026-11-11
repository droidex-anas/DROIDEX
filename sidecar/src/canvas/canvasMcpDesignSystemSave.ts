// canvas_theme's save (design system documents spec §11). The agent sends
// changes, not a whole document: the kit is built from its base, the changes
// applied, validated and compiled. A new kit then saves as version 1; a change
// to an existing user kit becomes its pending proposal, which the user accepts
// or discards in the document. The agent never changes a saved kit itself, since
// a kit serves many canvases and a silent change would restyle all of them.

import { z } from 'zod';
import { boundDiagnostics } from './canvasDiagnostics.js';
import { CanvasCommandError, canvasError } from './canvasError.js';
import { applyDocumentChanges, documentChangesSchema } from './designSystemEdits.js';
import { starterKit } from './designSystemImport.js';
import { importProjectDesignSystem } from './designSystemProject.js';
import { proposeDesignSystem } from './designSystemProposals.js';
import {
  DESIGN_SYSTEM_LIMITS,
  designSystemKind,
  designSystemSchema,
  readDesignSystem,
  saveDesignSystem,
  type DesignSystem,
} from './designSystems.js';
import { KIT_CATALOG_FILE, type KitFailure } from './kitCatalog.js';
import type { KitPreviews } from './kitPreviews.js';
import { leaveOutFailingSeeds } from './libraryCatalog.js';
import type { CanvasDiagnostic } from './protocol.js';
import {
  canvasIdentifierSchema,
  designSystemVersionRefSchema,
  sourceFilesSchema,
} from './schema.js';

const COVER_EXAMPLE = 'cover.tsx';

const projectSourceSchema = z
  .object({
    path: z.string().min(1).max(256),
    kind: z.enum(['tailwind', 'css', 'tokens', 'designMd', 'shadcn']),
  })
  .strict();

const kitSchema = z
  .union([
    z
      .object({ id: canvasIdentifierSchema, baseVersion: z.number().int().positive().safe() })
      .strict(),
    z
      .object({
        id: canvasIdentifierSchema,
        from: z.union([
          z.literal('blank'),
          z.object({ copy: designSystemVersionRefSchema }).strict(),
          z.object({ project: z.array(projectSourceSchema).min(1).max(8) }).strict(),
        ]),
      })
      .strict(),
  ])
  .describe(
    "An existing kit's id and the version you read, or a new id and what it starts from: 'blank' (the shared primitives with default token values), { copy: { id, version } }, or { project: [{ path, kind }] }: theme files of this chat's project folder, named relative to it, with kind tailwind (a Tailwind config), css (a stylesheet of custom properties), tokens (a JS, TS or JSON module of token objects, read for its literals) or designMd (one markdown design doc at most); or, alone, a shadcn/ui library's components.json with kind shadcn, which copies its components into the kit with its stylesheet's tokens and its Tailwind config's theme. DROIDEX imports them under their own token names; follow with changes for what the import missed.",
  );

/** What a save adds to canvas_theme's input; a save needs `kit`. */
export const kitSaveShape = {
  kit: kitSchema,
  name: z.string().trim().min(1).max(DESIGN_SYSTEM_LIMITS.maxNameLength).optional(),
  changes: documentChangesSchema.optional(),
  files: sourceFilesSchema.optional().describe('Changed kit files, each with its whole contents.'),
  examples: sourceFilesSchema
    .optional()
    .describe('Changed example files for the cover and previews, each with its whole contents.'),
  cover: z
    .literal('preview')
    .nullable()
    .optional()
    .describe(`'preview' makes examples ${COVER_EXAMPLE} the cover; null removes the cover.`),
};

type KitSave = z.infer<z.ZodObject<typeof kitSaveShape>> & { mutationId: string };

/** A kit whose source does not build; the diagnostics name each file and line. */
export class KitBuildError extends CanvasCommandError {
  constructor(readonly diagnostics: CanvasDiagnostic[]) {
    super(
      'invalid_source',
      'The design system does not build. Fix the files the diagnostics name and save again.',
    );
  }
}

export interface KitSaveContext {
  appSessionId: string;
  kits: Pick<KitPreviews, 'check'>;
  /** The chat's project folder, or null for a chat without one. */
  projectFolder: () => string | null;
  /** Throws once the turn has ended, so nothing it started publishes after it. */
  beforePublish: () => void;
}

export async function saveKit(
  input: KitSave,
  context: KitSaveContext,
): Promise<Record<string, unknown>> {
  const { base, baseVersion, diagnostics, seeded } = await kitBase(input, context);
  const edited: Omit<DesignSystem, 'version'> = {
    ...base,
    name: input.name ?? base.name,
    cover: coverOf(input.cover, base.cover),
    sections: applyDocumentChanges(base.sections, input.changes ?? []),
    files: { ...base.files, ...input.files },
    examples: { ...base.examples, ...input.examples },
  };
  const parsed = designSystemSchema.safeParse({ ...edited, version: (baseVersion ?? 0) + 1 });
  if (!parsed.success)
    throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? 'That kit is not valid.');
  // The seeded demos are the import's own until the save writes the catalog itself.
  const seeds = seeded && !Object.hasOwn(input.files ?? {}, KIT_CATALOG_FILE);
  const built = await checkKit(parsed.data, seeds, context.kits);
  if (built.failures.length > 0)
    throw new KitBuildError(boundDiagnostics(built.failures.map(({ diagnostic }) => diagnostic)));
  const kit = { ...edited, files: built.files };
  const reported = boundDiagnostics([...diagnostics, ...built.diagnostics]);

  const { appSessionId, beforePublish } = context;
  const { mutationId } = input;
  if (baseVersion === null) {
    const savedBy = { actor: 'agent' as const, appSessionId };
    const ref = await saveDesignSystem(kit, { mutationId, baseVersion, savedBy, beforePublish });
    return {
      status: 'saved',
      ref: { id: ref.id, version: ref.version },
      diagnostics: reported,
    };
  }
  await proposeDesignSystem(kit, { mutationId, baseVersion, appSessionId, beforePublish });
  return {
    status: 'proposed',
    id: kit.id,
    baseVersion,
    diagnostics: reported,
    message: `The user reviews this proposal in the design system's document. Builds keep using version ${String(baseVersion)} until they accept it.`,
  };
}

/**
 * Checks the kit as it will be saved. When it carries a library's seeded
 * demos, those that do not build are left out rather than refused, and the
 * kit is checked again without them.
 */
async function checkKit(
  kit: DesignSystem,
  seeds: boolean,
  kits: KitSaveContext['kits'],
): Promise<{
  files: DesignSystem['files'];
  failures: KitFailure[];
  diagnostics: CanvasDiagnostic[];
}> {
  const failures = await kits.check(kit);
  if (!seeds || failures.length === 0 || failures.some(({ entry }) => entry === null))
    return { files: kit.files, failures, diagnostics: [] };
  const left = leaveOutFailingSeeds(kit, failures);
  return {
    files: left.kit.files,
    failures: await kits.check(left.kit),
    diagnostics: left.diagnostics,
  };
}

/**
 * What the save builds on, the version it builds after (none for a new kit),
 * what reading project files reported, and whether it carries a library's
 * seeded catalog.
 */
async function kitBase(
  input: KitSave,
  context: KitSaveContext,
): Promise<{
  base: Omit<DesignSystem, 'version'>;
  baseVersion: number | null;
  diagnostics: CanvasDiagnostic[];
  seeded: boolean;
}> {
  const { kit } = input;
  if ('baseVersion' in kit) {
    if (designSystemKind(kit.id) !== 'user')
      throw canvasError(
        'preset_read_only',
        `Presets are read-only. Make your own kit from it with kit: { id: 'a-new-id', from: { copy: { id: '${kit.id}', version: ${String(kit.baseVersion)} } } }.`,
      );
    const base = await readDesignSystem({ id: kit.id, version: kit.baseVersion });
    return { base, baseVersion: kit.baseVersion, diagnostics: [], seeded: false };
  }
  if (designSystemKind(kit.id) !== 'user')
    throw canvasError('preset_read_only', 'That id belongs to a built-in kit. Choose another id.');
  if (kit.from === 'blank') {
    if (input.name === undefined) throw canvasError('invalid_input', 'Name the new design system.');
    return {
      base: { id: kit.id, name: input.name, ...starterKit() },
      baseVersion: null,
      diagnostics: [],
      seeded: false,
    };
  }
  if ('copy' in kit.from) {
    const { copy } = kit.from;
    const original = await readDesignSystem(copy);
    const name = `${original.name} copy`;
    return {
      base: { ...original, id: kit.id, name, provenance: { copiedFrom: copy } },
      baseVersion: null,
      diagnostics: [],
      seeded: false,
    };
  }
  if (input.name === undefined) throw canvasError('invalid_input', 'Name the new design system.');
  const folder = context.projectFolder();
  if (folder === null)
    throw canvasError(
      'invalid_input',
      'This chat has no project folder to read. Start from blank or a copy.',
    );
  const imported = await importProjectDesignSystem(folder, kit.from.project, {
    id: kit.id,
    name: input.name,
  });
  if (imported.status === 'refused')
    throw canvasError('invalid_input', imported.diagnostics[0].message);
  const { provenance } = imported.system;
  return {
    base: imported.system,
    baseVersion: null,
    diagnostics: imported.diagnostics,
    seeded:
      provenance !== undefined &&
      'project' in provenance &&
      provenance.project.library !== undefined,
  };
}

function coverOf(cover: KitSave['cover'], current: DesignSystem['cover']): DesignSystem['cover'] {
  if (cover === undefined) return current;
  return cover === null ? null : { kind: 'preview', example: COVER_EXAMPLE };
}
