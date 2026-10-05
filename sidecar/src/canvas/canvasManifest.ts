// The persisted state of one canvas and the wire values projected from it. The
// manifest is an untrusted boundary: it is re-validated on every load, and the
// workspace never reads a field this module has not parsed.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canvasError } from './canvasError.js';
import type {
  CanvasChange,
  CanvasFrame,
  CanvasSnapshot,
  CanvasSummary,
  CreateFramesResult,
  WriteReceipt,
} from './protocol.js';
import {
  CANVAS_LIMITS,
  canvasIdentifierSchema,
  designSystemRefSchema,
  frameRectSchema,
} from './schema.js';

export const CANVAS_MANIFEST_VERSION = 1;

/**
 * How many retries one canvas answers. Dropping a receipt would let a retry
 * execute a second time, so an evicted ID is remembered by name and refused
 * instead: the long tail of IDs costs far less than a duplicate frame.
 */
export const CANVAS_MUTATION_RETENTION = { receipts: 256, expiredIds: 4096 } as const;

const timestampSchema = z.number().int().nonnegative();
const versionSchema = z.number().int().nonnegative();
// An appSessionId never reaches a filesystem path, so it is bounded, not charset-checked.
const appSessionIdSchema = z.string().min(1).max(200);

const persistedDesignSchema = z
  .object({
    designId: canvasIdentifierSchema,
    name: z.string().min(1).max(CANVAS_LIMITS.maxFrameNameLength),
    rect: frameRectSchema,
    layoutVersion: versionSchema,
    revisionId: canvasIdentifierSchema.nullable(),
    designSystem: designSystemRefSchema,
  })
  .strict();

// Each record holds the value its command returned, so a retry after a lost
// response answers the original result rather than today's state.
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);

// What one accepted arrange acknowledged, and all it has to retain: the layout
// an arrange changes is the layout a retry has to answer for.
const placementSchema = z
  .object({
    designId: canvasIdentifierSchema,
    layoutVersion: versionSchema,
    rect: frameRectSchema,
  })
  .strict();

const persistedMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      mutationId: canvasIdentifierSchema,
      fingerprint: fingerprintSchema,
      designs: z.array(persistedDesignSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      mutationId: canvasIdentifierSchema,
      fingerprint: fingerprintSchema,
      designId: canvasIdentifierSchema,
      revisionId: canvasIdentifierSchema,
      sequence: versionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('arrange'),
      mutationId: canvasIdentifierSchema,
      fingerprint: fingerprintSchema,
      sequence: versionSchema,
      placements: z.array(placementSchema),
    })
    .strict(),
]);

export const canvasManifestSchema = z
  .object({
    version: z.literal(CANVAS_MANIFEST_VERSION),
    canvasId: canvasIdentifierSchema,
    name: z.string().min(1).max(CANVAS_LIMITS.maxFrameNameLength),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    sequence: versionSchema,
    // Spec §7: the manifest owns its attachment references, so an unattached
    // chat's first create commits the canvas and the attachment in one write.
    attachedAppSessionIds: z.array(appSessionIdSchema),
    designs: z.array(persistedDesignSchema),
    mutations: z.array(persistedMutationSchema).max(CANVAS_MUTATION_RETENTION.receipts),
    // Mutation IDs whose receipts aged out. Remembering them is what makes
    // eviction safe: a retry past the window is refused, never re-executed.
    expiredMutationIds: z.array(canvasIdentifierSchema).max(CANVAS_MUTATION_RETENTION.expiredIds),
  })
  .strict()
  .refine((manifest) => !hasDuplicate(manifest.designs.map((design) => design.designId)), {
    message: 'A canvas manifest holds each design once.',
  })
  .refine((manifest) => !hasDuplicate(manifest.mutations.map((record) => record.mutationId)), {
    message: 'A canvas manifest holds each mutation ID once.',
  });

export type PersistedDesign = z.infer<typeof persistedDesignSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type PersistedMutation = z.infer<typeof persistedMutationSchema>;
export type CanvasManifest = z.infer<typeof canvasManifestSchema>;

export function emptyCanvasManifest(canvasId: string, name: string, now: number): CanvasManifest {
  return {
    version: CANVAS_MANIFEST_VERSION,
    canvasId,
    name,
    createdAt: now,
    updatedAt: now,
    sequence: 0,
    attachedAppSessionIds: [],
    designs: [],
    mutations: [],
    expiredMutationIds: [],
  };
}

// Build state is a derived cache (spec §7), so nothing persists it; Task 3 owns
// the registry that replaces this projection with a real build.
export function toFrame(design: PersistedDesign): CanvasFrame {
  return {
    designId: design.designId,
    name: design.name,
    rect: { ...design.rect },
    layoutVersion: design.layoutVersion,
    revisionId: design.revisionId,
    designSystem: { ...design.designSystem },
    build: { status: 'pending' },
  };
}

export function canvasSnapshot(manifest: CanvasManifest): CanvasSnapshot {
  return {
    canvasId: manifest.canvasId,
    sequence: manifest.sequence,
    frames: manifest.designs.map(toFrame),
  };
}

export function canvasSummary(manifest: CanvasManifest): CanvasSummary {
  return {
    canvasId: manifest.canvasId,
    name: manifest.name,
    updatedAt: manifest.updatedAt,
    designCount: manifest.designs.length,
  };
}

export function canvasChange(
  manifest: CanvasManifest,
  designs: readonly PersistedDesign[],
): CanvasChange {
  return {
    canvasId: manifest.canvasId,
    sequence: manifest.sequence,
    frames: designs.map(toFrame),
    removedDesignIds: [],
  };
}

export function recordedCreate(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): CreateFramesResult | null {
  const record = findMutation(manifest, mutationId, 'create', fingerprint);
  if (record?.kind !== 'create') return null;
  return { canvasId: manifest.canvasId, frames: record.designs.map(toFrame) };
}

export function recordedWrite(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): WriteReceipt | null {
  const record = findMutation(manifest, mutationId, 'write', fingerprint);
  if (record?.kind !== 'write') return null;
  return { designId: record.designId, revisionId: record.revisionId, sequence: record.sequence };
}

export function recordedArrange(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'arrange', fingerprint);
  if (record?.kind !== 'arrange') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    // The layout comes from the record, the rest of each frame from the current
    // head, so a frame later commits removed is simply no longer in the answer.
    frames: record.placements.flatMap((placement) => {
      const design = manifest.designs.find((entry) => entry.designId === placement.designId);
      return design ? [toFrame({ ...design, ...placement })] : [];
    }),
    removedDesignIds: [],
  };
}

/** The layout an accepted arrange acknowledged, which is all a retry answers. */
export function toPlacements(designs: readonly PersistedDesign[]): Placement[] {
  return designs.map((design) => ({
    designId: design.designId,
    layoutVersion: design.layoutVersion,
    rect: { ...design.rect },
  }));
}

/** A digest of one command's arguments, so a retried ID must carry that request. */
export function mutationFingerprint(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** Appends a committed mutation, retiring the oldest receipt past retention. */
export function recordMutation(manifest: CanvasManifest, record: PersistedMutation): void {
  manifest.mutations.push(record);
  while (manifest.mutations.length > CANVAS_MUTATION_RETENTION.receipts) {
    const retired = manifest.mutations.shift();
    if (!retired) return;
    manifest.expiredMutationIds.push(retired.mutationId);
    while (manifest.expiredMutationIds.length > CANVAS_MUTATION_RETENTION.expiredIds)
      manifest.expiredMutationIds.shift();
  }
}

// A reused mutation ID is a programming error on the caller's side, not a
// retry: answering the old result would silently discard the new request, and
// re-executing it would spend an ID the caller believes it already used.
function findMutation(
  manifest: CanvasManifest,
  mutationId: string,
  kind: PersistedMutation['kind'],
  fingerprint: string,
): PersistedMutation | undefined {
  const record = manifest.mutations.find((entry) => entry.mutationId === mutationId);
  if (!record) {
    if (manifest.expiredMutationIds.includes(mutationId))
      throw canvasError(
        'invalid_input',
        'That mutation ID is past the retry window. Read the current board and send a new change.',
      );
    return undefined;
  }
  if (record.kind !== kind)
    throw canvasError('invalid_input', 'That mutation ID already belongs to a different change.');
  if (record.fingerprint !== fingerprint)
    throw canvasError(
      'invalid_input',
      'That mutation ID was already used with different arguments. Use a new mutation ID.',
    );
  return record;
}

// Key order and absent optional fields must not change a request's identity,
// so the digest reads one canonical form rather than JSON.stringify's.
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const fields = Object.entries(value)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`);
  return `{${fields.join(',')}}`;
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
