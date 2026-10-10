// Board mutations share the workspace commit queue and manifest with source
// writes. The manifest owns tombstones; build state remains derived.

import { randomUUID } from 'node:crypto';
import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasCommits } from './canvasCommits.js';
import { canvasError } from './canvasError.js';
import type { CanvasHeads } from './canvasHeads.js';
import type { CanvasLeases } from './canvasLeases.js';
import {
  canvasChange,
  CANVAS_TOMBSTONE_LIMIT,
  mutationFingerprint,
  recordedArrange,
  recordedRemove,
  recordedRename,
  recordedUndo,
  recordMutation,
  requireDesign,
  toPlacements,
  type PersistedDesign,
  type Placement,
} from './canvasManifest.js';
import type { ArrangeFramesInput, CanvasChange, CanvasScope, FrameRect } from './protocol.js';
import {
  removeFramesInputSchema,
  renameFrameInputSchema,
  undoRemovalInputSchema,
} from './schema.js';

export class CanvasFrameEdits {
  constructor(
    private readonly heads: CanvasHeads,
    private readonly leases: CanvasLeases,
    private readonly builds: CanvasBuilds,
    private readonly commits: CanvasCommits,
  ) {}

  arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange> {
    return this.commits.admit(async () => {
      this.commits.requireOpen();
      const designIds = input.frames.map((frame) => frame.designId);
      const fingerprint = mutationFingerprint(input);
      const manifest = this.leases.requireDesigns(scope, designIds);
      const recorded = recordedArrange(manifest, input.mutationId, fingerprint, this.builds);
      if (recorded) return recorded;

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, designIds);
        const again = recordedArrange(live, input.mutationId, fingerprint, this.builds);
        if (again) return { value: again };
        const next = structuredClone(live);
        const moved: PersistedDesign[] = [];
        for (const frame of input.frames) {
          const design = requireDesign(next, frame.designId);
          if (design.layoutVersion !== frame.expectedLayoutVersion)
            throw canvasError(
              'revision_conflict',
              'That frame moved. Read its current layout version and place it again.',
            );
          design.rect = { ...frame.rect };
          design.layoutVersion += 1;
          design.manifestVersion += 1;
          moved.push(design);
        }
        next.sequence += 1;
        next.layoutSequence += 1;
        next.updatedAt = Date.now();
        recordMutation(
          next,
          {
            kind: 'arrange',
            mutationId: input.mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            sequence: next.sequence,
            placements: toPlacements(moved),
          },
          this.leases.isActive,
        );
        await this.heads.install(next, this.scopedGate(scope, designIds));
        const change = canvasChange(next, moved, this.builds);
        return { value: change, change };
      });
    });
  }

  removeFrames(
    scope: CanvasScope,
    mutationId: string,
    designIds: string[],
  ): Promise<{ undoId: string }> {
    return this.commits.admit(async () => {
      const input = parse(removeFramesInputSchema, { mutationId, designIds });
      this.commits.requireOpen();
      const fingerprint = mutationFingerprint(input);
      const manifest = this.leases.requireDesigns(scope, input.designIds);
      const recorded = recordedRemove(manifest, mutationId, fingerprint);
      if (recorded) return recorded;

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, input.designIds);
        const again = recordedRemove(live, mutationId, fingerprint);
        if (again) return { value: again };
        const next = structuredClone(live);
        const removed = input.designIds.map((id) => requireDesign(next, id));
        const occupants = next.designs.filter(
          (design) =>
            !input.designIds.includes(design.designId) &&
            removed.some((entry) => overlaps(entry.rect, design.rect)),
        );
        const undoId = randomUUID();
        next.designs = next.designs.filter((design) => !input.designIds.includes(design.designId));
        next.sequence += 1;
        next.layoutSequence += 1;
        next.updatedAt = Date.now();
        next.tombstones.push({
          undoId,
          removedAt: next.updatedAt,
          expectedLayoutSequence: next.layoutSequence,
          occupants: toPlacements(occupants),
          designs: removed,
          consumed: false,
        });
        next.tombstones.splice(0, Math.max(0, next.tombstones.length - CANVAS_TOMBSTONE_LIMIT));
        recordMutation(
          next,
          {
            kind: 'remove',
            mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            undoId,
          },
          this.leases.isActive,
        );
        try {
          await this.heads.install(next, this.scopedGate(scope, input.designIds));
        } finally {
          // A failed durability flush may still have published the removal;
          // cancelling also lets a surviving old head rebuild on its next read.
          for (const id of input.designIds) this.builds.cancelDesign(next.canvasId, id);
        }
        return {
          value: { undoId },
          change: {
            canvasId: next.canvasId,
            sequence: next.sequence,
            frames: [],
            removedDesignIds: input.designIds,
          },
        };
      });
    });
  }

  undoRemoval(scope: CanvasScope, mutationId: string, undoId: string): Promise<CanvasChange> {
    return this.commits.admit(async () => {
      const input = parse(undoRemovalInputSchema, { mutationId, undoId });
      this.commits.requireOpen();
      const manifest = this.leases.requireScopedCanvas(scope);
      const fingerprint = mutationFingerprint(input);
      const recorded = recordedUndo(manifest, mutationId, fingerprint, this.builds);
      if (recorded) {
        this.leases.requireDesigns(
          scope,
          recorded.frames.map((frame) => frame.designId),
        );
        return recorded;
      }
      const tombstone = manifest.tombstones.find((entry) => entry.undoId === undoId);
      if (!tombstone || tombstone.consumed)
        throw canvasError('invalid_input', 'That Undo is no longer available. Refresh the canvas.');
      const designIds = tombstone.designs.map((design) => design.designId);
      this.leases.requireDesigns(scope, designIds);

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, designIds);
        const again = recordedUndo(live, mutationId, fingerprint, this.builds);
        if (again) return { value: again };
        const next = structuredClone(live);
        const pending = next.tombstones.find((entry) => entry.undoId === undoId);
        if (!pending || pending.consumed)
          throw canvasError('invalid_input', 'That Undo was already used. Refresh the canvas.');
        if (pending.expectedLayoutSequence !== next.layoutSequence) {
          const changed = changedOccupant(next.designs, pending.designs, pending.occupants);
          if (changed)
            throw canvasError(
              'layout_conflict',
              'Another frame now occupies that location. Move it, then try Undo again.',
              changed.rect,
            );
        }
        for (const design of pending.designs) {
          if (next.designs.some((entry) => entry.designId === design.designId))
            throw canvasError(
              'revision_conflict',
              'That frame identity is already on the canvas. Refresh it.',
            );
        }
        const restored = pending.designs.map((design) => ({
          ...design,
          layoutVersion: design.layoutVersion + 1,
          manifestVersion: design.manifestVersion + 1,
        }));
        next.designs.push(...restored);
        pending.consumed = true;
        next.sequence += 1;
        next.layoutSequence += 1;
        next.updatedAt = Date.now();
        recordMutation(
          next,
          {
            kind: 'undo',
            mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            sequence: next.sequence,
            designs: structuredClone(restored),
          },
          this.leases.isActive,
        );
        await this.heads.install(next, this.scopedGate(scope, designIds));
        for (const design of restored) {
          if (design.revisionId !== null)
            this.builds.enqueue(next.canvasId, design.designId, design.revisionId);
        }
        const change = canvasChange(next, restored, this.builds);
        return { value: change, change };
      });
    });
  }

  renameFrame(
    scope: CanvasScope,
    mutationId: string,
    designId: string,
    name: string,
    expectedManifestVersion: number,
  ): Promise<CanvasChange> {
    return this.commits.admit(async () => {
      const input = parse(renameFrameInputSchema, {
        mutationId,
        designId,
        name,
        expectedManifestVersion,
      });
      this.commits.requireOpen();
      const manifest = this.leases.requireDesigns(scope, [designId]);
      const fingerprint = mutationFingerprint(input);
      const recorded = recordedRename(manifest, mutationId, fingerprint, this.builds);
      if (recorded) return recorded;

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, [designId]);
        const again = recordedRename(live, mutationId, fingerprint, this.builds);
        if (again) return { value: again };
        const next = structuredClone(live);
        const design = requireDesign(next, designId);
        if (design.manifestVersion !== input.expectedManifestVersion)
          throw canvasError(
            'revision_conflict',
            'That frame changed. Refresh it, then rename again.',
          );
        design.name = input.name;
        design.manifestVersion += 1;
        next.sequence += 1;
        next.updatedAt = Date.now();
        recordMutation(
          next,
          {
            kind: 'rename',
            mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            sequence: next.sequence,
            design: structuredClone(design),
          },
          this.leases.isActive,
        );
        await this.heads.install(next, this.scopedGate(scope, [designId]));
        const change = canvasChange(next, [design], this.builds);
        return { value: change, change };
      });
    });
  }

  private scopedGate(scope: CanvasScope, designIds: string[]): () => void {
    return () => {
      this.commits.requireOpen();
      this.leases.requireDesigns(scope, designIds);
    };
  }
}

function overlaps(left: FrameRect, right: FrameRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function changedOccupant(
  current: PersistedDesign[],
  removed: PersistedDesign[],
  expected: Placement[],
): PersistedDesign | null {
  for (const design of current) {
    if (!removed.some((entry) => overlaps(entry.rect, design.rect))) continue;
    const previous = expected.find((entry) => entry.designId === design.designId);
    if (previous?.layoutVersion !== design.layoutVersion) return design;
  }
  return null;
}

function parse<T>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw canvasError('invalid_input', result.error.issues[0]?.message ?? 'Invalid Canvas change.');
  return result.data;
}
