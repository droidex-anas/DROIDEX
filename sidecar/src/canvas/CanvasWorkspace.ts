// The durable owner of Canvas frames, immutable source, attachments and retries.
// Revision staging precedes serialized manifest publication; its final gate
// checks lease and job identity. CanvasHeads owns which manifest is current.

import { randomUUID } from 'node:crypto';
import type { CanvasBuilds } from './CanvasBuilds.js';
import { CanvasAttachments } from './canvasAttachments.js';
import { importCanvasImage, type CanvasImageImport } from './canvasAssets.js';
import type { BuildCommit, BuildTarget } from './canvasBuildHost.js';
import { CanvasChangeFeed } from './canvasChangeFeed.js';
import { CanvasCommits, CLOSING } from './canvasCommits.js';
import { canvasError, CanvasCommandError } from './canvasError.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { CanvasFrameEdits } from './CanvasFrameEdits.js';
import { placeFrames, requireSeedFrames, stageFrames, stageRevision } from './canvasFrames.js';
import { CanvasHeads, UNREADABLE_CANVAS } from './canvasHeads.js';
import { CanvasLeases, type CanvasLeaseRegistry } from './canvasLeases.js';
import { CanvasWriterLease } from './canvasWriterLease.js';
import {
  canvasChange,
  canvasSnapshot,
  canvasSummary,
  emptyCanvasManifest,
  mutationFingerprint,
  recordedCreate,
  recordedRevision,
  recordMutation,
  requireDesign,
  requireExpectedRevision,
  toFrame,
  type CanvasManifest,
} from './canvasManifest.js';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasScope,
  CanvasSnapshot,
  CanvasSummary,
  CreateFramesInput,
  CreateFramesResult,
  EditElementInput,
  OwnedAsset,
  RevisionRef,
  SourceFiles,
  WriteFilesInput,
  WriteReceipt,
} from './protocol.js';

export interface CanvasWorkspaceDeps extends CanvasLeaseRegistry {
  isChatKnown: (appSessionId: string) => boolean;
  fs?: CanvasFileSystem;
}

const ATTACHED_SINCE = 'This chat was attached to a canvas after that request.';

export class CanvasWorkspace {
  /** Every committed change, in sequence, for the pane to project. */
  readonly changes = new CanvasChangeFeed();
  private readonly commits = new CanvasCommits(this.changes);
  private readonly attachments: CanvasAttachments;
  private readonly frameEdits: CanvasFrameEdits;
  private readonly root: string;

  private constructor(
    private readonly files: CanvasFiles,
    private readonly heads: CanvasHeads,
    private readonly leases: CanvasLeases,
    private readonly builds: CanvasBuilds,
    private readonly writerLease: CanvasWriterLease,
    isChatKnown: (appSessionId: string) => boolean,
  ) {
    this.attachments = new CanvasAttachments(heads, this.commits, isChatKnown);
    this.root = writerLease.directory;
    this.frameEdits = new CanvasFrameEdits(heads, leases, builds, this.commits);
  }

  /** Claims the physical storage root before loading heads or cleaning staging. */
  static async open(
    directory: string,
    builds: CanvasBuilds,
    deps: CanvasWorkspaceDeps,
  ): Promise<CanvasWorkspace> {
    const writerLease = await CanvasWriterLease.acquire(directory);
    try {
      const files = new CanvasFiles(writerLease.directory, deps.fs);
      const heads = await CanvasHeads.load(files);
      const leases = new CanvasLeases(deps, heads);
      const workspace = new CanvasWorkspace(
        files,
        heads,
        leases,
        builds,
        writerLease,
        deps.isChatKnown,
      );
      await builds.load(workspace, files, heads.all());
      return workspace;
    } catch (error) {
      writerLease.release();
      throw error;
    }
  }

  snapshot(canvasId: string): CanvasSnapshot {
    return canvasSnapshot(this.canvas(canvasId), this.builds);
  }

  listCanvases(): CanvasSummary[] {
    return this.heads.all().map(canvasSummary);
  }

  /** Canvases that exist on disk but are not served, for a recovery action. */
  damagedCanvasIds(): string[] {
    return this.heads.damagedIds();
  }

  importCanvasImage(request: CanvasImageImport): Promise<OwnedAsset> {
    return this.commits.admit(() => {
      this.commits.requireOpen();
      this.canvas(request.canvasId);
      return importCanvasImage(this.root, request);
    });
  }

  /** The canvas a chat works on, or null while the chat is unattached (spec §6). */
  attachedCanvasId(appSessionId: string): string | null {
    return this.heads.attachedCanvasId(appSessionId);
  }

  /** Explicit creation retries return the same durable identity, without reattaching. */
  createCanvas(
    appSessionId: string,
    mutationId: string,
    name?: string,
  ): Promise<{ canvasId: string }> {
    return this.commits.admit(() =>
      this.commits.run(() => this.attachments.createCanvas(appSessionId, mutationId, name)),
    );
  }

  attach(appSessionId: string, canvasId: string): Promise<void> {
    return this.commits.admit(() =>
      this.commits.run(() => this.attachments.attach(appSessionId, canvasId)),
    );
  }

  detach(appSessionId: string): Promise<void> {
    return this.commits.admit(() => this.commits.run(() => this.attachments.detach(appSessionId)));
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
      if (bootstrapping) this.attachments.requireChat(scope.appSessionId);
      const canvasId = target ?? randomUUID();
      if (!bootstrapping) {
        this.leases.requireAttachment(scope, canvasId);
        requireSeedFrames(this.leases.requireCanvas(scope, canvasId), input);
      }
      const staged = await stageFrames(this.files, canvasId, input);

      return this.commits.publish(async () => {
        let next: CanvasManifest;
        let beforeRename: () => void;
        if (bootstrapping) {
          const attached = this.attachedCanvasId(scope.appSessionId);
          if (attached !== null) {
            const recorded = recordedCreate(
              this.canvas(attached),
              input.mutationId,
              fingerprint,
              this.builds,
            );
            if (recorded) {
              this.leases.claim(scope, attached);
              return { value: recorded };
            }
            throw canvasError('scope_expired', ATTACHED_SINCE);
          }
          this.leases.requireActive(scope);
          next = emptyCanvasManifest(canvasId, this.attachments.nextCanvasName(), Date.now());
          // Spec §6: the canvas, the chat's attachment and the lease's binding
          // are one commit, so a half-attached canvas never exists.
          next.attachedAppSessionIds.push(scope.appSessionId);
          beforeRename = () => {
            this.commits.requireOpen();
            this.attachments.requireChat(scope.appSessionId);
            this.leases.requireActive(scope);
            if (this.attachedCanvasId(scope.appSessionId) !== null)
              throw canvasError('scope_expired', ATTACHED_SINCE);
          };
        } else {
          this.leases.requireAttachment(scope, canvasId);
          const live = this.leases.requireCanvas(scope, canvasId);
          const recorded = recordedCreate(live, input.mutationId, fingerprint, this.builds);
          if (recorded) return { value: recorded };
          requireSeedFrames(live, input);
          next = structuredClone(live);
          beforeRename = () => {
            this.commits.requireOpen();
            this.leases.requireAttachment(scope, canvasId);
            this.leases.requireCanvas(scope, canvasId);
          };
        }
        const designs = placeFrames(staged, next.designs, input.placeBeside);
        next.designs.push(...designs);
        next.layoutSequence += 1;
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
        // A seeded frame arrives with source, so it is built like a write's.
        for (const design of designs) {
          if (design.revisionId !== null)
            this.builds.enqueue(canvasId, design.designId, design.revisionId);
        }
        return {
          value: {
            canvasId,
            frames: designs.map((design) => toFrame(canvasId, design, this.builds)),
          },
          change: canvasChange(next, designs, this.builds),
        };
      });
    });
  }

  recordedEdit(scope: CanvasScope, input: EditElementInput): WriteReceipt | null {
    this.commits.requireOpen();
    const manifest = this.leases.requireDesigns(scope, [input.edit.element.designId]);
    return recordedRevision(manifest, input.mutationId, 'edit', mutationFingerprint(input));
  }

  // Direct edits retain their original request fingerprint, not the derived file write.
  write(
    scope: CanvasScope,
    input: WriteFilesInput,
    options: {
      edit?: EditElementInput;
      validateSource?: (files: ReadonlyMap<string, string>) => void | Promise<void>;
    } = {},
  ): Promise<WriteReceipt> {
    const { edit, validateSource } = options;
    return this.commits.admit(async () => {
      this.commits.requireOpen();
      const manifest = this.leases.requireDesigns(scope, [input.designId]);
      const canvasId = manifest.canvasId;
      const kind = edit ? 'edit' : 'write';
      const fingerprint = mutationFingerprint(edit ?? input);
      const recorded = recordedRevision(manifest, input.mutationId, kind, fingerprint);
      if (recorded) return recorded;

      const design = requireDesign(manifest, input.designId);
      requireExpectedRevision(design, input.expectedRevisionId);
      const revision = await stageRevision(this.files, canvasId, design, input, validateSource);

      return this.commits.publish(async () => {
        const live = this.leases.requireDesigns(scope, [input.designId]);
        const again = recordedRevision(live, input.mutationId, kind, fingerprint);
        if (again) return { value: again };
        const next = structuredClone(live);
        const target = requireDesign(next, input.designId);
        requireExpectedRevision(target, input.expectedRevisionId);
        target.revisionId = revision.revisionId;
        target.designSystem = revision.designSystem;
        target.manifestVersion += 1;
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
            kind,
            mutationId: input.mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            ...receipt,
          },
          this.leases.isActive,
        );
        await this.heads.install(next, this.scopedGate(scope, [input.designId]));
        // The revision is durable, so it can be built. Queuing it here is what
        // makes the change below report this revision's own build and never the
        // previous one's artifact (spec §4).
        this.builds.enqueue(canvasId, receipt.designId, receipt.revisionId);
        return { value: receipt, change: canvasChange(next, [target], this.builds) };
      });
    });
  }

  arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange> {
    return this.frameEdits.arrange(scope, input);
  }

  removeFrames(
    scope: CanvasScope,
    mutationId: string,
    designIds: string[],
  ): Promise<{ undoId: string }> {
    return this.frameEdits.removeFrames(scope, mutationId, designIds);
  }

  undoRemoval(scope: CanvasScope, mutationId: string, undoId: string): Promise<CanvasChange> {
    return this.frameEdits.undoRemoval(scope, mutationId, undoId);
  }

  renameFrame(
    scope: CanvasScope,
    mutationId: string,
    designId: string,
    name: string,
    expectedManifestVersion: number,
  ): Promise<CanvasChange> {
    return this.frameEdits.renameFrame(scope, mutationId, designId, name, expectedManifestVersion);
  }

  async readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles> {
    requireDesign(this.canvas(canvasId), ref.designId);
    const tree = await this.files.readRevision(canvasId, ref);
    requireDesign(this.canvas(canvasId), ref.designId);
    // A null-prototype tree, so a source path can never reach an inherited
    // member even if the path rules change.
    const files = Object.create(null) as SourceFiles;
    for (const [path, content] of tree) files[path] = content;
    return files;
  }

  /**
   * What a build pins its result to, or null once its canvas or frame is gone.
   * `CanvasBuilds` calls this again after every await before it publishes.
   */
  buildTarget(canvasId: string, designId: string): BuildTarget | null {
    const design = this.heads.find(canvasId)?.designs.find((entry) => entry.designId === designId);
    if (!design) return null;
    return {
      frame: toFrame(canvasId, design, this.builds),
      lastWorkingRevisionId: design.lastWorkingRevisionId,
    };
  }

  /**
   * Publishes one frame on this canvas's commit queue, the queue a write
   * commits on, so a build's gate, its outcome file and its state all land in
   * one serialized step with the head held still. `publish` answers with the
   * revision the design now falls back to (spec §7), or null to publish
   * nothing at all.
   */
  commitBuild(
    canvasId: string,
    designId: string,
    publish: () => Promise<BuildCommit | null>,
  ): Promise<void> {
    return this.commits
      .admit(() =>
        this.commits.publish<undefined>(async () => {
          const live = this.heads.find(canvasId);
          const design = live?.designs.find((entry) => entry.designId === designId);
          // A build that outlived its canvas has nothing left to report.
          if (!live || !design) return { value: undefined };
          const committed = await publish();
          if (!committed) return { value: undefined };
          const next = structuredClone(live);
          const target = requireDesign(next, designId);
          if (committed.workingRevisionId !== null)
            target.lastWorkingRevisionId = committed.workingRevisionId;
          target.manifestVersion += 1;
          next.sequence += 1;
          await this.heads.install(next, () => {
            this.commits.requireOpen();
            if (!committed.isCurrent())
              throw canvasError('scope_expired', 'That Canvas build is no longer wanted.');
          });
          return { value: undefined, change: canvasChange(next, [target], this.builds) };
        }),
      )
      .catch((error: unknown) => {
        // Closing or a superseded build cancels publication. Other failures
        // leave derived memory state for the pane's next snapshot.
        if (
          error instanceof CanvasCommandError &&
          (error.message === CLOSING || error.code === 'scope_expired')
        )
          return;
        console.error(`A Canvas ${canvasId} build state was not published:`, error);
      });
  }

  /** Resolves once every admitted mutation has settled, staging included. */
  async close(): Promise<void> {
    await this.commits.drain();
    this.leases.forget();
    this.changes.clear();
    this.writerLease.release();
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
    const recorded = recordedCreate(manifest, mutationId, fingerprint, this.builds);
    if (recorded && scope.canvasId === null) this.leases.claim(scope, canvasId);
    return recorded;
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
}
