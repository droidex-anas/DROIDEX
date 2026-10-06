// The durable owner of every canvas: frames, layout, immutable source
// revisions, attachments and mutation retries (spec §7). Commits run one at a
// time, each one writes and flushes its revision tree before it replaces a
// manifest, and the lease is checked once more with the replacement ready and
// nothing published. `canvasHeads.ts` owns which manifest is current.

import { randomUUID } from 'node:crypto';
import { CanvasChangeFeed } from './canvasChangeFeed.js';
import { CanvasCommits } from './canvasCommits.js';
import { canvasError } from './canvasError.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { placeFrames, stageFrames, stageRevision } from './canvasFrames.js';
import { CanvasHeads, UNREADABLE_CANVAS } from './canvasHeads.js';
import { CanvasLeases, type CanvasLeaseRegistry } from './canvasLeases.js';
import {
  canvasChange,
  canvasSnapshot,
  canvasSummary,
  emptyCanvasManifest,
  mutationFingerprint,
  recordedArrange,
  recordedCreate,
  recordedWrite,
  recordMutation,
  toFrame,
  toPlacements,
  type CanvasManifest,
  type PersistedDesign,
} from './canvasManifest.js';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasScope,
  CanvasSnapshot,
  CanvasSummary,
  CreateFramesInput,
  CreateFramesResult,
  RevisionRef,
  SourceFiles,
  WriteFilesInput,
  WriteReceipt,
} from './protocol.js';

export interface CanvasWorkspaceDeps extends CanvasLeaseRegistry {
  fs?: CanvasFileSystem;
}

const ATTACHED_SINCE = 'This chat was attached to a canvas after that request.';

export class CanvasWorkspace {
  /** Every committed change, in sequence, for the pane to project. */
  readonly changes = new CanvasChangeFeed();
  private readonly commits = new CanvasCommits(this.changes);

  private constructor(
    private readonly files: CanvasFiles,
    private readonly heads: CanvasHeads,
    private readonly leases: CanvasLeases,
  ) {}

  static async open(directory: string, deps: CanvasWorkspaceDeps): Promise<CanvasWorkspace> {
    const files = new CanvasFiles(directory, deps.fs);
    const heads = await CanvasHeads.load(files);
    return new CanvasWorkspace(files, heads, new CanvasLeases(deps, heads));
  }

  snapshot(canvasId: string): CanvasSnapshot {
    return canvasSnapshot(this.canvas(canvasId));
  }

  listCanvases(): CanvasSummary[] {
    return this.heads.all().map(canvasSummary);
  }

  /** Canvases that exist on disk but are not served, for a recovery action. */
  damagedCanvasIds(): string[] {
    return this.heads.damagedIds();
  }

  /** The canvas a chat works on, or null while the chat is unattached (spec §6). */
  attachedCanvasId(appSessionId: string): string | null {
    return this.heads.attachedCanvasId(appSessionId);
  }

  /**
   * A new canvas, attached in the same commit so explicit Create leaves either
   * nothing or this chat's canvas (spec §6). The chat leaves its previous canvas
   * first: a crash between the two writes must leave it unattached, not twice.
   */
  createCanvas(appSessionId: string): Promise<CanvasSnapshot> {
    return this.commits.admit(() =>
      this.commits.run(async () => {
        await this.detachFrom(appSessionId, null);
        const manifest = emptyCanvasManifest(randomUUID(), this.nextCanvasName(), Date.now());
        manifest.attachedAppSessionIds.push(appSessionId);
        await this.heads.install(manifest, this.openGate());
        return canvasSnapshot(manifest);
      }),
    );
  }

  attach(appSessionId: string, canvasId: string): Promise<void> {
    return this.commits.admit(() =>
      this.commits.run(async () => {
        // Refuse an unknown canvas before detaching the chat from its current one.
        this.canvas(canvasId);
        await this.detachFrom(appSessionId, canvasId);
        const next = structuredClone(this.canvas(canvasId));
        if (next.attachedAppSessionIds.includes(appSessionId)) return;
        next.attachedAppSessionIds.push(appSessionId);
        next.updatedAt = Date.now();
        await this.heads.install(next, this.openGate());
      }),
    );
  }

  detach(appSessionId: string): Promise<void> {
    return this.commits.admit(() => this.commits.run(() => this.detachFrom(appSessionId, null)));
  }

  create(scope: CanvasScope, input: CreateFramesInput): Promise<CreateFramesResult> {
    return this.commits.admit(async () => {
      this.commits.requireOpen();
      // A lease bound to named designs may change those frames, not add more.
      if (scope.allowedDesignIds !== 'canvas')
        throw canvasError('scope_expired', 'This turn may change only the frames it was given.');
      this.leases.requireActive(scope);
      const fingerprint = mutationFingerprint(input);
      // A seeded frame copies a whole revision, so a retry is answered before
      // any of that is staged; the commit checks again for a racing retry.
      const settled = this.recordedCreate(scope, input.mutationId, fingerprint);
      if (settled) return settled;
      // A lease minted without a canvas takes the one its first create made:
      // a later create under it extends that canvas instead of making another.
      const target = this.leases.pinnedCanvas(scope);
      const bootstrapping = target === null;
      const canvasId = target ?? randomUUID();
      if (!bootstrapping) {
        this.leases.requireAttachment(scope, canvasId);
        this.leases.requireCanvas(scope, canvasId);
      }
      const staged = await stageFrames(this.files, canvasId, input);

      return this.commits.publish(async () => {
        let next: CanvasManifest;
        let beforeRename: () => void;
        if (bootstrapping) {
          const attached = this.attachedCanvasId(scope.appSessionId);
          if (attached !== null) {
            const recorded = recordedCreate(this.canvas(attached), input.mutationId, fingerprint);
            if (recorded) {
              this.leases.claim(scope, attached);
              return { value: recorded };
            }
            throw canvasError('scope_expired', ATTACHED_SINCE);
          }
          this.leases.requireActive(scope);
          next = emptyCanvasManifest(canvasId, this.nextCanvasName(), Date.now());
          // Spec §6: the canvas, the chat's attachment and the lease's binding
          // are one commit, so a half-attached canvas never exists.
          next.attachedAppSessionIds.push(scope.appSessionId);
          beforeRename = () => {
            this.commits.requireOpen();
            this.leases.requireActive(scope);
            if (this.attachedCanvasId(scope.appSessionId) !== null)
              throw canvasError('scope_expired', ATTACHED_SINCE);
          };
        } else {
          this.leases.requireAttachment(scope, canvasId);
          const live = this.leases.requireCanvas(scope, canvasId);
          const recorded = recordedCreate(live, input.mutationId, fingerprint);
          if (recorded) return { value: recorded };
          next = structuredClone(live);
          beforeRename = () => {
            this.commits.requireOpen();
            this.leases.requireAttachment(scope, canvasId);
            this.leases.requireCanvas(scope, canvasId);
          };
        }
        const designs = placeFrames(staged, next.designs);
        next.designs.push(...designs);
        next.sequence += 1;
        next.updatedAt = Date.now();
        recordMutation(
          next,
          {
            kind: 'create',
            mutationId: input.mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            designs: structuredClone(designs),
          },
          this.leases.isActive,
        );
        try {
          await this.heads.install(next, beforeRename);
        } catch (error) {
          // A save that landed anyway made this canvas the lease's, which the
          // attachment index records whether or not the save finished.
          if (scope.canvasId === null && this.attachedCanvasId(scope.appSessionId) === canvasId)
            this.leases.pin(scope, canvasId);
          throw error;
        }
        if (scope.canvasId === null) this.leases.claim(scope, canvasId);
        return {
          value: { canvasId, frames: designs.map(toFrame) },
          change: canvasChange(next, designs),
        };
      });
    });
  }

  write(scope: CanvasScope, input: WriteFilesInput): Promise<WriteReceipt> {
    return this.commits.admit(async () => {
      this.commits.requireOpen();
      const manifest = this.leases.requireDesigns(scope, [input.designId]);
      const canvasId = manifest.canvasId;
      const fingerprint = mutationFingerprint(input);
      const recorded = recordedWrite(manifest, input.mutationId, fingerprint);
      if (recorded) return recorded;

      const design = this.design(manifest, input.designId);
      requireExpectedRevision(design, input.expectedRevisionId);
      const revision = await stageRevision(this.files, canvasId, design, input);

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, [input.designId]);
        const again = recordedWrite(live, input.mutationId, fingerprint);
        if (again) return { value: again };
        const next = structuredClone(live);
        const target = this.design(next, input.designId);
        requireExpectedRevision(target, input.expectedRevisionId);
        target.revisionId = revision.revisionId;
        target.designSystem = revision.designSystem;
        next.sequence += 1;
        next.updatedAt = Date.now();
        const receipt: WriteReceipt = {
          designId: input.designId,
          revisionId: revision.revisionId,
          sequence: next.sequence,
        };
        recordMutation(
          next,
          {
            kind: 'write',
            mutationId: input.mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            ...receipt,
          },
          this.leases.isActive,
        );
        await this.heads.install(next, this.scopedGate(scope, [input.designId]));
        return { value: receipt, change: canvasChange(next, [target]) };
      });
    });
  }

  arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange> {
    return this.commits.admit(async () => {
      this.commits.requireOpen();
      const designIds = input.frames.map((frame) => frame.designId);
      const fingerprint = mutationFingerprint(input);
      const manifest = this.leases.requireDesigns(scope, designIds);
      const recorded = recordedArrange(manifest, input.mutationId, fingerprint);
      if (recorded) return recorded;

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, designIds);
        const again = recordedArrange(live, input.mutationId, fingerprint);
        if (again) return { value: again };
        const next = structuredClone(live);
        const moved: PersistedDesign[] = [];
        for (const frame of input.frames) {
          const design = this.design(next, frame.designId);
          if (design.layoutVersion !== frame.expectedLayoutVersion)
            throw canvasError(
              'revision_conflict',
              'That frame moved. Read its current layout version and place it again.',
            );
          design.rect = { ...frame.rect };
          design.layoutVersion += 1;
          moved.push(design);
        }
        next.sequence += 1;
        next.updatedAt = Date.now();
        recordMutation(
          next,
          {
            kind: 'arrange',
            mutationId: input.mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            sequence: next.sequence,
            // A retry answers this sequence and this layout; a frame's other
            // fields follow the current head, which the renderer discards as old.
            placements: toPlacements(moved),
          },
          this.leases.isActive,
        );
        await this.heads.install(next, this.scopedGate(scope, designIds));
        const change = canvasChange(next, moved);
        return { value: change, change };
      });
    });
  }

  async readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles> {
    // An unreferenced revision still reads, but only from a canvas we hold.
    this.canvas(canvasId);
    const tree = await this.files.readRevision(canvasId, ref);
    // A null-prototype tree, so a source path can never reach an inherited
    // member even if the path rules change.
    const files = Object.create(null) as SourceFiles;
    for (const [path, content] of tree) files[path] = content;
    return files;
  }

  /** Resolves once every admitted mutation has settled, staging included. */
  async close(): Promise<void> {
    await this.commits.drain();
    this.leases.forget();
    this.changes.clear();
  }

  /** Canvas files are kept: detaching a chat only drops the reference. */
  private async detachFrom(appSessionId: string, keep: string | null): Promise<void> {
    const attached = this.attachedCanvasId(appSessionId);
    if (attached !== null && attached !== keep && this.heads.isDamaged(attached))
      throw canvasError('storage_failed', UNREADABLE_CANVAS);
    for (const manifest of this.heads.all()) {
      if (manifest.canvasId === keep) continue;
      if (!manifest.attachedAppSessionIds.includes(appSessionId)) continue;
      const next = structuredClone(manifest);
      next.attachedAppSessionIds = next.attachedAppSessionIds.filter((id) => id !== appSessionId);
      next.updatedAt = Date.now();
      await this.heads.install(next, this.openGate());
    }
  }

  /**
   * The receipt this create already has, if it has one. An unattached lease
   * finds it through the attachment its first create committed, which is also
   * the only record of a canvas whose response was lost.
   */
  private recordedCreate(
    scope: CanvasScope,
    mutationId: string,
    fingerprint: string,
  ): CreateFramesResult | null {
    // The lease's own canvas, never whichever one happens to hold the ID.
    const canvasId = this.leases.pinnedCanvas(scope);
    if (canvasId === null) return null;
    // The attachment is real even when the head is not readable, so this chat
    // waits for recovery rather than being handed a second canvas.
    if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
    // A receipt for a canvas this chat has left answers nothing it can act on.
    this.leases.requireAttachment(scope, canvasId);
    const manifest = this.heads.find(canvasId);
    if (!manifest) return null;
    const recorded = recordedCreate(manifest, mutationId, fingerprint);
    if (recorded && scope.canvasId === null) this.leases.claim(scope, canvasId);
    return recorded;
  }

  /** The final check a commit with no lease behind it runs before publishing. */
  private openGate(): () => void {
    return () => {
      this.commits.requireOpen();
    };
  }

  /** The final check a leased commit runs, with its replacement manifest ready. */
  private scopedGate(scope: CanvasScope, designIds: readonly string[]): () => void {
    return () => {
      this.commits.requireOpen();
      this.leases.requireDesigns(scope, designIds);
    };
  }

  private canvas(canvasId: string): CanvasManifest {
    const manifest = this.heads.find(canvasId);
    if (manifest) return manifest;
    if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
    throw canvasError('invalid_input', 'That canvas is not open.');
  }

  private design(manifest: CanvasManifest, designId: string): PersistedDesign {
    const design = manifest.designs.find((entry) => entry.designId === designId);
    if (!design) throw canvasError('invalid_input', 'That frame is not on this canvas.');
    return design;
  }

  private nextCanvasName(): string {
    return `Canvas ${String(this.heads.all().length + 1)}`;
  }
}

function requireExpectedRevision(design: PersistedDesign, expected: string | null): void {
  if (design.revisionId === expected) return;
  throw canvasError(
    'revision_conflict',
    'That frame has a newer revision. Read it and apply your change again.',
  );
}
