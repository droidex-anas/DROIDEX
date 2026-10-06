// The persisted state of one canvas and the wire values projected from it. The
// manifest is an untrusted boundary: it is re-validated on every load, and the
// workspace never reads a field this module has not parsed.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canvasError } from './canvasError.js';
import type {
  CanvasBuildState,
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

const CANVAS_MANIFEST_VERSION = 1;

/**
 * How many retries one canvas answers. A retry can only be authorized while the
 * lease that issued it lives, so an unsettled receipt is never retired and
 * settled leases give way oldest first past `retained`. Once a lease is gone,
 * nothing can retry under it, so a receipt that is no longer found is executed
 * as the new request it now is. `unsettled` is the ceiling on receipts no lease
 * has released yet: past it the ledger refuses the new mutation, because
 * retiring one would let its retry run twice.
 */
export const CANVAS_MUTATION_RETENTION = { retained: 256, unsettled: 4096 } as const;

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
    // Spec §7: the manifest owns the revision a failed build falls back to.
    // The artifact itself is a derived cache that `CanvasBuilds` rebuilds.
    lastWorkingRevisionId: canvasIdentifierSchema.nullable(),
    designSystem: designSystemRefSchema,
  })
  .strict();

// Each record holds the value its command returned, so a retry after a lost
// response answers the original result rather than today's state.
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
// A lease ID never reaches a filesystem path, so it is bounded, not charset-checked.
const scopeIdSchema = z.string().min(1).max(200);

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
      scopeId: scopeIdSchema,
      fingerprint: fingerprintSchema,
      designs: z.array(persistedDesignSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      mutationId: canvasIdentifierSchema,
      scopeId: scopeIdSchema,
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
      scopeId: scopeIdSchema,
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
    mutations: z.array(persistedMutationSchema).max(CANVAS_MUTATION_RETENTION.unsettled),
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
  };
}

/** Where a frame's build state comes from: `CanvasBuilds` is its one owner. */
export interface BuildStates {
  stateOf(canvasId: string, designId: string): CanvasBuildState;
}

export function toFrame(
  canvasId: string,
  design: PersistedDesign,
  builds: BuildStates,
): CanvasFrame {
  return {
    designId: design.designId,
    name: design.name,
    rect: { ...design.rect },
    layoutVersion: design.layoutVersion,
    revisionId: design.revisionId,
    designSystem: { ...design.designSystem },
    build: builds.stateOf(canvasId, design.designId),
  };
}

export function canvasSnapshot(manifest: CanvasManifest, builds: BuildStates): CanvasSnapshot {
  return {
    canvasId: manifest.canvasId,
    sequence: manifest.sequence,
    frames: manifest.designs.map((design) => toFrame(manifest.canvasId, design, builds)),
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
  builds: BuildStates,
): CanvasChange {
  return {
    canvasId: manifest.canvasId,
    sequence: manifest.sequence,
    frames: designs.map((design) => toFrame(manifest.canvasId, design, builds)),
    removedDesignIds: [],
  };
}

export function recordedCreate(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
  builds: BuildStates,
): CreateFramesResult | null {
  const record = findMutation(manifest, mutationId, 'create', fingerprint);
  if (record?.kind !== 'create') return null;
  return {
    canvasId: manifest.canvasId,
    frames: record.designs.map((design) => toFrame(manifest.canvasId, design, builds)),
  };
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

export function requireExpectedRevision(design: PersistedDesign, expected: string | null): void {
  if (design.revisionId === expected) return;
  throw canvasError(
    'revision_conflict',
    'That frame has a newer revision. Read it and apply your change again.',
  );
}

export function recordedArrange(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
  builds: BuildStates,
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
      return design ? [toFrame(manifest.canvasId, { ...design, ...placement }, builds)] : [];
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

/**
 * Appends a committed mutation and retires receipts no live lease can retry.
 * Nothing is appended when the unsettled receipts alone fill the ledger: a
 * retry of one of those would execute a second time, so refusing the new
 * mutation is the only answer that keeps every accepted change replayable.
 */
export function recordMutation(
  manifest: CanvasManifest,
  record: PersistedMutation,
  isScopeActive: (scopeId: string) => boolean,
): void {
  const settled = manifest.mutations.filter((entry) => !isScopeActive(entry.scopeId));
  if (manifest.mutations.length - settled.length >= CANVAS_MUTATION_RETENTION.unsettled)
    throw canvasError(
      'storage_failed',
      'This canvas has too many unsettled mutations. Finish or interrupt the current turns and try again.',
    );
  manifest.mutations.push(record);
  const over = manifest.mutations.length - CANVAS_MUTATION_RETENTION.retained;
  if (over <= 0) return;
  const retired = new Set(settled.slice(0, over));
  manifest.mutations = manifest.mutations.filter((entry) => !retired.has(entry));
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
  if (!record) return undefined;
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
