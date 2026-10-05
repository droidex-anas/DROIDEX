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
import { CanvasHeads } from './canvasHeads.js';
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

export interface CanvasWorkspaceDeps {
  /** Task 4's lease registry: false once the owning turn settled or was replaced. */
  isScopeActive(scopeId: string): boolean;
  /** Fills an unattached chat's lease with the canvas its first create minted. */
  bindScopeCanvas(scopeId: string, canvasId: string): void;
  fs?: CanvasFileSystem;
}

/** Gap between a created frame and its neighbour, for deterministic placement. */
const FRAME_GAP_PX = 80;

const EXPIRED_TURN = 'That request belongs to a turn that already ended.';
const ATTACHED_SINCE = 'This chat was attached to a canvas after that request.';
const CLOSING = 'The Canvas workspace is closing.';
const UNREADABLE_CANVAS = 'That canvas could not be read. Reopen DROIDEX to recover it.';

/** One frame's identity and seeded source, prepared before the commit owner runs. */
interface StagedFrame {
  designId: string;
  revisionId: string | null;
  frame: CreateFramesInput['frames'][number];
}

export class CanvasWorkspace {
  private commits: Promise<unknown> = Promise.resolve();
  private readonly running = new Set<Promise<void>>();
  private closed = false;

  private constructor(
    private readonly files: CanvasFiles,
    private readonly deps: CanvasWorkspaceDeps,
    private readonly heads: CanvasHeads,
  ) {}

  static async open(directory: string, deps: CanvasWorkspaceDeps): Promise<CanvasWorkspace> {
    const files = new CanvasFiles(directory, deps.fs);
    return new CanvasWorkspace(files, deps, await CanvasHeads.load(files));
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

  createCanvas(): Promise<CanvasSnapshot> {
    return this.admit(() =>
      this.commit(async () => {
        const manifest = emptyCanvasManifest(randomUUID(), this.nextCanvasName(), Date.now());
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
      this.requireActiveScope(scope);
      const fingerprint = mutationFingerprint(input);
      const unattached = scope.canvasId === null;
      // Identities and seeded source are prepared outside the commit owner; the
      // retry answer and the placement need the manifest the commit extends.
      const canvasId = unattached ? randomUUID() : this.requireScopedCanvas(scope).canvasId;
      const staged = await this.stageFrames(canvasId, input);

      return this.commit(async () => {
        let next: CanvasManifest;
        let beforeRename: () => void;
        if (unattached) {
          const attached = this.attachedCanvasId(scope.appSessionId);
          if (attached !== null) {
            const recorded = recordedCreate(this.canvas(attached), input.mutationId, fingerprint);
            if (recorded) return recorded;
            throw canvasError('scope_expired', ATTACHED_SINCE);
          }
          this.requireActiveScope(scope);
          next = emptyCanvasManifest(canvasId, this.nextCanvasName(), Date.now());
          // Spec §6: the canvas, the chat's attachment and the lease's binding
          // are one commit, so a half-attached canvas never exists.
          next.attachedAppSessionIds.push(scope.appSessionId);
          beforeRename = () => {
            this.requireOpen();
            this.requireActiveScope(scope);
            if (this.attachedCanvasId(scope.appSessionId) !== null)
              throw canvasError('scope_expired', ATTACHED_SINCE);
          };
        } else {
          const live = this.requireScopedCanvas(scope);
          const recorded = recordedCreate(live, input.mutationId, fingerprint);
          if (recorded) return recorded;
          next = structuredClone(live);
          beforeRename = this.scopedGate(scope, []);
        }
        const designs = placeFrames(staged, next.designs);
        next.designs.push(...designs);
        next.sequence += 1;
        next.updatedAt = Date.now();
        recordMutation(next, {
          kind: 'create',
          mutationId: input.mutationId,
          fingerprint,
          designs: structuredClone(designs),
        });
        await this.heads.install(next, beforeRename);
        if (unattached) this.deps.bindScopeCanvas(scope.scopeId, canvasId);
        return { canvasId, frames: designs.map(toFrame) };
      });
    });
  }

  write(scope: CanvasScope, input: WriteFilesInput): Promise<WriteReceipt> {
    return this.admit(async () => {
      this.requireOpen();
      const manifest = this.requireScopedDesigns(scope, [input.designId]);
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

      return this.commit(async () => {
        const live = this.requireScopedDesigns(scope, [input.designId]);
        const again = recordedWrite(live, input.mutationId, fingerprint);
        if (again) return again;
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
        recordMutation(next, {
          kind: 'write',
          mutationId: input.mutationId,
          fingerprint,
          ...receipt,
        });
        await this.heads.install(next, this.scopedGate(scope, [input.designId]));
        return receipt;
      });
    });
  }

  arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange> {
    return this.admit(async () => {
      this.requireOpen();
      const designIds = input.frames.map((frame) => frame.designId);
      const fingerprint = mutationFingerprint(input);
      const manifest = this.requireScopedDesigns(scope, designIds);
      const recorded = recordedArrange(manifest, input.mutationId, fingerprint);
      if (recorded) return recorded;

      return this.commit(async () => {
        const live = this.requireScopedDesigns(scope, designIds);
        const again = recordedArrange(live, input.mutationId, fingerprint);
        if (again) return again;
        const next = structuredClone(live);
        const moved: PersistedDesign[] = [];
        for (const frame of input.frames) {
          const design = this.design(next, frame.designId);
          if (design.layoutVersion !== frame.expectedLayoutVersion)
            throw canvasError(
              'revision_conflict',
              'That frame moved. Read its current layout version and place it again.',
            );
          design.rect = frame.rect;
          design.layoutVersion += 1;
          // A copy: the record answers a retry with the result it returned, not
          // with wherever the frame ends up later.
          moved.push(structuredClone(design));
        }
        next.sequence += 1;
        next.updatedAt = Date.now();
        recordMutation(next, {
          kind: 'arrange',
          mutationId: input.mutationId,
          fingerprint,
          sequence: next.sequence,
          designs: moved,
        });
        await this.heads.install(next, this.scopedGate(scope, designIds));
        return canvasChange(next, moved);
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

  /** Canvas files are kept: detaching a chat only drops the reference. */
  private async detachFrom(appSessionId: string, keep: string | null): Promise<void> {
    for (const manifest of this.heads.all()) {
      if (manifest.canvasId === keep) continue;
      if (!manifest.attachedAppSessionIds.includes(appSessionId)) continue;
      const next = structuredClone(manifest);
      next.attachedAppSessionIds = next.attachedAppSessionIds.filter((id) => id !== appSessionId);
      next.updatedAt = Date.now();
      await this.heads.install(next, this.openGate());
    }
  }

  /** Mints identities and copies any seeded source before the commit owner runs. */
  private async stageFrames(canvasId: string, input: CreateFramesInput): Promise<StagedFrame[]> {
    const staged: StagedFrame[] = [];
    for (const frame of input.frames) {
      const designId = randomUUID();
      const revisionId = await this.stageSeed(canvasId, designId, frame);
      staged.push({ designId, revisionId, frame });
    }
    return staged;
  }

  /** A seeded frame owns an independent copy of the seed's source tree. */
  private async stageSeed(
    canvasId: string,
    designId: string,
    frame: CreateFramesInput['frames'][number],
  ): Promise<string | null> {
    const seed = frame.seed;
    if (!seed) return null;
    if (seed.kind === 'library')
      throw canvasError('invalid_input', 'Seeding from the library is not available yet.');
    if (seed.canvasId !== canvasId)
      throw canvasError('invalid_input', 'A seed revision must come from this canvas.');
    const files = await this.files.readRevision(canvasId, seed.revision);
    const revisionId = randomUUID();
    await this.files.publishRevision(
      canvasId,
      {
        version: REVISION_METADATA_VERSION,
        designId,
        revisionId,
        parentRevisionId: seed.revision.revisionId,
        designSystem: frame.designSystem,
        createdAt: Date.now(),
      },
      files,
    );
    return revisionId;
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
      this.requireScopedDesigns(scope, designIds);
    };
  }

  private requireActiveScope(scope: CanvasScope): void {
    if (!this.deps.isScopeActive(scope.scopeId)) throw canvasError('scope_expired', EXPIRED_TURN);
  }

  /** The canvas a lease authorizes; a lease for a canvas we do not hold is stale. */
  private requireScopedCanvas(scope: CanvasScope): CanvasManifest {
    this.requireActiveScope(scope);
    const canvasId = scope.canvasId;
    if (canvasId === null)
      throw canvasError('invalid_input', 'This chat has no canvas yet. Create a frame first.');
    const manifest = this.heads.find(canvasId);
    if (manifest) return manifest;
    if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
    throw canvasError('scope_expired', 'That request names a canvas this workspace does not hold.');
  }

  private requireScopedDesigns(scope: CanvasScope, designIds: readonly string[]): CanvasManifest {
    const manifest = this.requireScopedCanvas(scope);
    const allowed = scope.allowedDesignIds;
    if (allowed === 'canvas') return manifest;
    for (const designId of designIds) {
      if (!allowed.includes(designId))
        throw canvasError('scope_expired', 'That frame is outside this turn’s assigned frames.');
    }
    return manifest;
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

/** New frames land in a row to the right of everything already placed. */
function placeFrames(
  staged: readonly StagedFrame[],
  placed: readonly PersistedDesign[],
): PersistedDesign[] {
  let x = 0;
  let y = 0;
  if (placed.length > 0) {
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    for (const design of placed) {
      right = Math.max(right, design.rect.x + design.rect.width);
      top = Math.min(top, design.rect.y);
    }
    x = right + FRAME_GAP_PX;
    y = top;
  }
  const designs: PersistedDesign[] = [];
  for (const { designId, revisionId, frame } of staged) {
    designs.push({
      designId,
      name: frame.name,
      rect: { x, y, width: frame.width, height: frame.height },
      layoutVersion: 0,
      revisionId,
      designSystem: frame.designSystem,
    });
    x += frame.width + FRAME_GAP_PX;
  }
  return designs;
}
