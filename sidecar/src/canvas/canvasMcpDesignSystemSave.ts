// canvas_theme's save (design system documents spec §11). The agent sends
// changes, not a whole document: the kit is built from its base, the changes
// applied, validated and compiled. A new kit then saves as version 1; a change
// to an existing user kit becomes its pending proposal, which the user accepts
// or discards in the document. The agent never changes a saved kit itself, since
// a kit serves many canvases and a silent change would restyle all of them.

import { z } from 'zod';
import { CanvasCommandError, canvasError } from './canvasError.js';
import { applyDocumentChanges, documentChangesSchema } from './designSystemEdits.js';
import { starterKit } from './designSystemImport.js';
import { proposeDesignSystem } from './designSystemProposals.js';
import {
  DESIGN_SYSTEM_LIMITS,
  designSystemKind,
  designSystemSchema,
  readDesignSystem,
  saveDesignSystem,
  type DesignSystem,
} from './designSystems.js';
import type { KitPreviews } from './kitPreviews.js';
import type { CanvasDiagnostic } from './protocol.js';
import {
  canvasIdentifierSchema,
  designSystemVersionRefSchema,
  sourceFilesSchema,
} from './schema.js';

const COVER_EXAMPLE = 'cover.tsx';

const projectSourceSchema = z
  .object({ path: z.string().min(1).max(256), kind: z.enum(['tailwind', 'css', 'designMd']) })
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
    "An existing kit's id and the version you read, or a new id and what it starts from: 'blank' (the shared primitives with DROIDEX's token values) or { copy: { id, version } }.",
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
  /** Throws once the turn has ended, so nothing it started publishes after it. */
  beforePublish: () => void;
}

export async function saveKit(
  input: KitSave,
  context: KitSaveContext,
): Promise<Record<string, unknown>> {
  const { base, baseVersion } = await kitBase(input);
  const kit: Omit<DesignSystem, 'version'> = {
    ...base,
    name: input.name ?? base.name,
    cover: coverOf(input.cover, base.cover),
    sections: applyDocumentChanges(base.sections, input.changes ?? []),
    files: { ...base.files, ...input.files },
    examples: { ...base.examples, ...input.examples },
  };
  const parsed = designSystemSchema.safeParse({ ...kit, version: (baseVersion ?? 0) + 1 });
  if (!parsed.success)
    throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? 'That kit is not valid.');
  const diagnostics = await context.kits.check(parsed.data);
  if (diagnostics.length > 0) throw new KitBuildError(diagnostics);

  const { appSessionId, beforePublish } = context;
  const { mutationId } = input;
  if (baseVersion === null) {
    const savedBy = { actor: 'agent' as const, appSessionId };
    const ref = await saveDesignSystem(kit, { mutationId, baseVersion, savedBy, beforePublish });
    return { status: 'saved', ref: { id: ref.id, version: ref.version }, diagnostics };
  }
  await proposeDesignSystem(kit, { mutationId, baseVersion, appSessionId, beforePublish });
  return {
    status: 'proposed',
    id: kit.id,
    baseVersion,
    diagnostics,
    message: `The user reviews this proposal in the design system's document. Builds keep using version ${String(baseVersion)} until they accept it.`,
  };
}

/** What the save builds on, and the version it builds after (none for a new kit). */
async function kitBase(
  input: KitSave,
): Promise<{ base: Omit<DesignSystem, 'version'>; baseVersion: number | null }> {
  const { kit } = input;
  if ('baseVersion' in kit) {
    if (designSystemKind(kit.id) !== 'user')
      throw canvasError(
        'preset_read_only',
        `Presets are read-only. Make your own kit from it with kit: { id: 'a-new-id', from: { copy: { id: '${kit.id}', version: ${String(kit.baseVersion)} } } }.`,
      );
    const base = await readDesignSystem({ id: kit.id, version: kit.baseVersion });
    return { base, baseVersion: kit.baseVersion };
  }
  if (designSystemKind(kit.id) !== 'user')
    throw canvasError('preset_read_only', 'That id belongs to a built-in kit. Choose another id.');
  if (kit.from === 'blank') {
    if (input.name === undefined) throw canvasError('invalid_input', 'Name the new design system.');
    return { base: { id: kit.id, name: input.name, ...starterKit() }, baseVersion: null };
  }
  if ('copy' in kit.from) {
    const { copy } = kit.from;
    const original = await readDesignSystem(copy);
    const name = `${original.name} copy`;
    return {
      base: { ...original, id: kit.id, name, provenance: { copiedFrom: copy } },
      baseVersion: null,
    };
  }
  throw canvasError(
    'invalid_input',
    'A design system cannot be made from project files yet. Start from blank or a copy.',
  );
}

function coverOf(cover: KitSave['cover'], current: DesignSystem['cover']): DesignSystem['cover'] {
  if (cover === undefined) return current;
  return cover === null ? null : { kind: 'preview', example: COVER_EXAMPLE };
}
