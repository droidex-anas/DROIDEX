// The durable owner of every canvas: frames, layout, immutable source
// revisions, attachments and mutation retries (spec §7). Commits run one at a
// time, each one writes and flushes its revision tree before it replaces a
// manifest, and the lease is checked once more with the replacement ready and
// nothing published. `canvasHeads.ts` owns which manifest is current.

import { randomUUID } from 'node:crypto';
import { canvasError, CanvasCommandError } from './canvasError.js';
import {
  CanvasFiles,
  REVISION_METADATA_VERSION,
  type CanvasFileSystem,
  type NewRevision,
} from './canvasFiles.js';
import { placeFrames, stageFrames } from './canvasFrames.js';
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
import { mergedRevisionViolation } from './schema.js';

export interface CanvasWorkspaceDeps extends CanvasLeaseRegistry {
  fs?: CanvasFileSystem;
}

const ATTACHED_SINCE = 'This chat was attached to a canvas after that request.';
const CLOSING = 'The Canvas workspace is closing.';

/** A commit's answer and the change it published, if it published one. */
interface Committed<T> {
  value: T;
  change?: CanvasChange;
}

export class CanvasWorkspace {
  private commits: Promise<unknown> = Promise.resolve();
  private readonly running = new Set<Promise<void>>();
  private readonly listeners = new Set<(change: CanvasChange) => void>();
  private closed = false;

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
   * Every committed change, in sequence. Agent tools mutate this workspace
   * directly, so this is the only way the pane learns about their work.
   */
  onChange(listener: (change: CanvasChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * A new canvas, attached to the chat that asked for it. Spec §6: explicit
   * Create commits the canvas and the attachment together, so a lost response
   * leaves either nothing or this chat's canvas. The chat leaves its previous
   * canvas first, because a crash between those two writes must leave it
   * unattached rather than attached twice.
   */
  createCanvas(appSessionId: string): Promise<CanvasSnapshot> {
    return this.admit(() =>
      this.commit(async () => {
        await this.detachFrom(appSessionId, null);
        const manifest = emptyCanvasManifest(randomUUID(), this.nextCanvasName(), Date.now());
        manifest.attachedAppSessionIds.push(appSessionId);
        await this.heads.install(manifest, this.openGate());
        return canvasSnapshot(manifest);
      }),
    );
  }

  attach(appSessionId: string, canvasId: string): Promise<void> {
    return this.admit(() =>
      this.commit(async () => {
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
    return this.admit(() => this.commit(() => this.detachFrom(appSessionId, null)));
  }

  create(scope: CanvasScope, input: CreateFramesInput): Promise<CreateFramesResult> {
    return this.admit(async () => {
      this.requireOpen();
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

      return this.commitChange(async () => {
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
            this.requireOpen();
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
            this.requireOpen();
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
    return this.admit(async () => {
      this.requireOpen();
      const manifest = this.leases.requireDesigns(scope, [input.designId]);
      const canvasId = manifest.canvasId;
      const fingerprint = mutationFingerprint(input);
      const recorded = recordedWrite(manifest, input.mutationId, fingerprint);
      if (recorded) return recorded;

      const design = this.design(manifest, input.designId);
      requireExpectedRevision(design, input.expectedRevisionId);
      const merged = mergeSource(await this.currentSource(canvasId, design), input);
      const violation = mergedRevisionViolation(merged);
      if (violation) throw canvasError('invalid_input', violation);
      const revision: NewRevision = {
        version: REVISION_METADATA_VERSION,
        designId: input.designId,
        revisionId: randomUUID(),
        parentRevisionId: design.revisionId,
        designSystem: input.designSystem ?? design.designSystem,
        createdAt: Date.now(),
      };
      await this.files.publishRevision(canvasId, revision, merged);

      return this.commitChange(async () => {
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
    return this.admit(async () => {
      this.requireOpen();
      const designIds = input.frames.map((frame) => frame.designId);
      const fingerprint = mutationFingerprint(input);
      const manifest = this.leases.requireDesigns(scope, designIds);
      const recorded = recordedArrange(manifest, input.mutationId, fingerprint);
      if (recorded) return recorded;

      return this.commitChange(async () => {
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
    this.closed = true;
    while (this.running.size > 0) await Promise.all([...this.running]);
    this.leases.forget();
    this.listeners.clear();
  }

  /** Admits one mutation, so close() knows what it still has to wait for. */
  private admit<T>(work: () => Promise<T>): Promise<T> {
    const running = (async () => work())();
    const settled = running.then(ignoreOutcome, ignoreOutcome);
    this.running.add(settled);
    void settled.then(() => this.running.delete(settled));
    return running;
  }

  /** One commit at a time; a failed commit never poisons the queue. */
  private commit<T>(work: () => Promise<T>): Promise<T> {
    const next = this.commits.catch(ignoreOutcome).then(() => {
      this.requireOpen();
      return work();
    });
    this.commits = next.catch(ignoreOutcome);
    return next;
  }

  /**
   * A commit that may publish a change. Listeners run once the lock has moved
   * on, so a subscriber cannot stall the next commit, and still in sequence,
   * because the queue hands the lock on in an earlier microtask. A retry
   * answers its original receipt and publishes nothing new.
   */
  private commitChange<T>(work: () => Promise<Committed<T>>): Promise<T> {
    return this.commit(work).then(({ value, change }) => {
      if (change) for (const listener of this.listeners) listener(change);
      return value;
    });
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

  /** The manifest points at this revision, so a missing tree is storage damage. */
  private async currentSource(
    canvasId: string,
    design: PersistedDesign,
  ): Promise<Map<string, string>> {
    const revisionId = design.revisionId;
    if (revisionId === null) return new Map<string, string>();
    try {
      return await this.files.readRevision(canvasId, { designId: design.designId, revisionId });
    } catch (error) {
      if (error instanceof CanvasCommandError && error.code === 'invalid_input')
        throw canvasError('storage_failed', 'The saved source for that frame is missing.');
      throw error;
    }
  }

  private requireOpen(): void {
    if (this.closed) throw canvasError('storage_failed', CLOSING);
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
      this.requireOpen();
    };
  }

  /** The final check a leased commit runs, with its replacement manifest ready. */
  private scopedGate(scope: CanvasScope, designIds: readonly string[]): () => void {
    return () => {
      this.requireOpen();
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

const ignoreOutcome = (): void => undefined;

function requireExpectedRevision(design: PersistedDesign, expected: string | null): void {
  if (design.revisionId === expected) return;
  throw canvasError(
    'revision_conflict',
    'That frame has a newer revision. Read it and apply your change again.',
  );
}

function mergeSource(current: Map<string, string>, input: WriteFilesInput): Map<string, string> {
  for (const path of input.deletedPaths) current.delete(path);
  for (const [path, content] of Object.entries(input.files)) current.set(path, content);
  return current;
}
