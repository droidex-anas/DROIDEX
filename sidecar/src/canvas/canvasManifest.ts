// The persisted state of one canvas and the wire values projected from it. The
// manifest is an untrusted boundary: it is re-validated on every load, and the
// workspace never reads a field this module has not parsed.

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

// A retained mutation only answers a response lost inside one turn, and the
// whole manifest is rewritten on every commit, so retention is tight: the
// oldest records are dropped past either bound.
const MAX_MUTATIONS = 128;
const MAX_MUTATION_BYTES = 64 * 1024;

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
const persistedMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      mutationId: canvasIdentifierSchema,
      designs: z.array(persistedDesignSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      mutationId: canvasIdentifierSchema,
      designId: canvasIdentifierSchema,
      revisionId: canvasIdentifierSchema,
      sequence: versionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('arrange'),
      mutationId: canvasIdentifierSchema,
      sequence: versionSchema,
      designs: z.array(persistedDesignSchema),
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
    mutations: z.array(persistedMutationSchema).max(MAX_MUTATIONS),
  })
  .strict()
  .refine((manifest) => !hasDuplicate(manifest.designs.map((design) => design.designId)), {
    message: 'A canvas manifest holds each design once.',
  })
  .refine((manifest) => !hasDuplicate(manifest.mutations.map((record) => record.mutationId)), {
    message: 'A canvas manifest holds each mutation ID once.',
  });

export type PersistedDesign = z.infer<typeof persistedDesignSchema>;
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
): CreateFramesResult | null {
  const record = findMutation(manifest, mutationId, 'create');
  if (record?.kind !== 'create') return null;
  return { canvasId: manifest.canvasId, frames: record.designs.map(toFrame) };
}

export function recordedWrite(manifest: CanvasManifest, mutationId: string): WriteReceipt | null {
  const record = findMutation(manifest, mutationId, 'write');
  if (record?.kind !== 'write') return null;
  return { designId: record.designId, revisionId: record.revisionId, sequence: record.sequence };
}

export function recordedArrange(manifest: CanvasManifest, mutationId: string): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'arrange');
  if (record?.kind !== 'arrange') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    frames: record.designs.map(toFrame),
    removedDesignIds: [],
  };
}

/** Appends a committed mutation and drops the oldest records past retention. */
export function recordMutation(manifest: CanvasManifest, record: PersistedMutation): void {
  manifest.mutations.push(record);
  while (
    manifest.mutations.length > MAX_MUTATIONS ||
    (manifest.mutations.length > 1 &&
      JSON.stringify(manifest.mutations).length > MAX_MUTATION_BYTES)
  ) {
    manifest.mutations.shift();
  }
}

// Reusing one mutation ID for a different command would commit a second change
// under an ID the caller believes it already spent.
function findMutation(
  manifest: CanvasManifest,
  mutationId: string,
  kind: PersistedMutation['kind'],
): PersistedMutation | undefined {
  const record = manifest.mutations.find((entry) => entry.mutationId === mutationId);
  if (record && record.kind !== kind)
    throw canvasError('invalid_input', 'That mutation ID already belongs to a different change.');
  return record;
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
