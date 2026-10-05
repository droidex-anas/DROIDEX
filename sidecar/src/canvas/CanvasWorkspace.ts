// The durable owner of every canvas: frames, layout, immutable source
// revisions, attachments and mutation retries (spec §7). Commits run one at a
// time, and each one writes its revision tree before it replaces a manifest, so
// a terminated process reopens on a complete old or new head.

import { randomUUID } from 'node:crypto';
import { canvasError } from './canvasError.js';
import {
  CanvasFiles,
  REVISION_METADATA_VERSION,
  type CanvasFileSystem,
  type NewRevision,
} from './canvasFiles.js';
import {
  canvasChange,
  canvasSnapshot,
  canvasSummary,
  emptyCanvasManifest,
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

export class CanvasWorkspace {
  private commits: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly files: CanvasFiles,
    private readonly deps: CanvasWorkspaceDeps,
    private readonly canvases: Map<string, CanvasManifest>,
  ) {}

  static async open(directory: string, deps: CanvasWorkspaceDeps): Promise<CanvasWorkspace> {
    const files = new CanvasFiles(directory, deps.fs);
    await files.createRoot();
    const canvases = new Map<string, CanvasManifest>();
    for (const canvasId of await files.listCanvasIds()) {
      const load = await files.loadManifest(canvasId);
      if (load.state === 'missing') continue;
      if (load.state === 'damaged') {
        // Left untouched on disk: repairing it here would be a guess, and one
        // unreadable board must not keep the others closed.
        console.error(`Canvas ${canvasId} was not opened because ${load.reason}.`);
        continue;
      }
      await files.removeTemporaries(canvasId);
      canvases.set(canvasId, load.manifest);
    }
    return new CanvasWorkspace(files, deps, canvases);
  }

  snapshot(canvasId: string): CanvasSnapshot {
    return canvasSnapshot(this.canvas(canvasId));
  }

  listCanvases(): CanvasSummary[] {
    return [...this.canvases.values()].map(canvasSummary);
  }

  /** The canvas a chat works on, or null while the chat is unattached (spec §6). */
  attachedCanvasId(appSessionId: string): string | null {
    for (const manifest of this.canvases.values()) {
      if (manifest.attachedAppSessionIds.includes(appSessionId)) return manifest.canvasId;
    }
    return null;
  }

  createCanvas(): Promise<CanvasSnapshot> {
    return this.commit(async () => {
      const manifest = emptyCanvasManifest(randomUUID(), this.nextCanvasName(), Date.now());
      await this.install(manifest);
      return canvasSnapshot(manifest);
    });
  }

  attach(appSessionId: string, canvasId: string): Promise<void> {
    return this.commit(async () => {
      // Refuse an unknown canvas before detaching the chat from its current one.
      this.canvas(canvasId);
      await this.detachFrom(appSessionId, canvasId);
      const next = structuredClone(this.canvas(canvasId));
      if (next.attachedAppSessionIds.includes(appSessionId)) return;
      next.attachedAppSessionIds.push(appSessionId);
      next.updatedAt = Date.now();
      await this.install(next);
    });
  }

  detach(appSessionId: string): Promise<void> {
    return this.commit(() => this.detachFrom(appSessionId, null));
  }

  async create(scope: CanvasScope, input: CreateFramesInput): Promise<CreateFramesResult> {
    // A lease bound to named designs may change those frames, not add more.
    if (scope.allowedDesignIds !== 'canvas')
      throw canvasError('scope_expired', 'This turn may change only the frames it was given.');
    this.requireActiveScope(scope);

    const existing = scope.canvasId === null ? null : this.requireScopedCanvas(scope);
    if (existing === null) {
      // An unattached lease's create may have committed and lost its response.
      const attached = this.attachedCanvasId(scope.appSessionId);
      if (attached !== null) {
        const recorded = recordedCreate(this.canvas(attached), input.mutationId);
        if (recorded) return recorded;
        throw canvasError('scope_expired', ATTACHED_SINCE);
      }
    } else {
      const recorded = recordedCreate(existing, input.mutationId);
      if (recorded) return recorded;
    }
    const canvasId = existing?.canvasId ?? randomUUID();
    const designs = await this.stageDesigns(canvasId, existing, input);

    return this.commit(async () => {
      const unattached = existing === null;
      let next: CanvasManifest;
      if (unattached) {
        this.requireActiveScope(scope);
        if (this.attachedCanvasId(scope.appSessionId) !== null)
          throw canvasError('scope_expired', ATTACHED_SINCE);
        next = emptyCanvasManifest(canvasId, this.nextCanvasName(), Date.now());
        // Spec §6: the canvas, the chat's attachment and the lease's binding
        // are one commit, so a half-attached canvas never exists.
        next.attachedAppSessionIds.push(scope.appSessionId);
      } else {
        const live = this.requireScopedCanvas(scope);
        const recorded = recordedCreate(live, input.mutationId);
        if (recorded) return recorded;
        next = structuredClone(live);
      }
      next.designs.push(...designs);
      next.sequence += 1;
      next.updatedAt = Date.now();
      recordMutation(next, {
        kind: 'create',
        mutationId: input.mutationId,
        designs: structuredClone(designs),
      });
      await this.install(next);
      if (unattached) this.deps.bindScopeCanvas(scope.scopeId, canvasId);
      return { canvasId, frames: designs.map(toFrame) };
    });
  }

  async write(scope: CanvasScope, input: WriteFilesInput): Promise<WriteReceipt> {
    const manifest = this.requireScopedDesigns(scope, [input.designId]);
    const canvasId = manifest.canvasId;
    const recorded = recordedWrite(manifest, input.mutationId);
    if (recorded) return recorded;

    const design = this.design(manifest, input.designId);
    requireExpectedRevision(design, input.expectedRevisionId);
    const merged = mergeSource(await this.currentSource(canvasId, design), input);
    const violation = mergedRevisionViolation(merged);
    if (violation) throw canvasError('invalid_input', violation);
    const metadata: NewRevision = {
      version: REVISION_METADATA_VERSION,
      designId: input.designId,
      revisionId: randomUUID(),
      parentRevisionId: design.revisionId,
      designSystem: input.designSystem ?? design.designSystem,
      createdAt: Date.now(),
    };
    await this.files.publishRevision(canvasId, metadata, merged);

    return this.commit(async () => {
      const live = this.requireScopedDesigns(scope, [input.designId]);
      const again = recordedWrite(live, input.mutationId);
      if (again) return again;
      const next = structuredClone(live);
      const target = this.design(next, input.designId);
      requireExpectedRevision(target, input.expectedRevisionId);
      target.revisionId = metadata.revisionId;
      target.designSystem = metadata.designSystem;
      next.sequence += 1;
      next.updatedAt = Date.now();
      const receipt: WriteReceipt = {
        designId: input.designId,
        revisionId: metadata.revisionId,
        sequence: next.sequence,
      };
      recordMutation(next, { kind: 'write', mutationId: input.mutationId, ...receipt });
      await this.install(next);
      return receipt;
    });
  }

  async arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange> {
    const designIds = input.frames.map((frame) => frame.designId);
    const manifest = this.requireScopedDesigns(scope, designIds);
    const recorded = recordedArrange(manifest, input.mutationId);
    if (recorded) return recorded;

    return this.commit(async () => {
      const live = this.requireScopedDesigns(scope, designIds);
      const again = recordedArrange(live, input.mutationId);
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
        sequence: next.sequence,
        designs: moved,
      });
      await this.install(next);
      return canvasChange(next, moved);
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

  async close(): Promise<void> {
    this.closed = true;
    await this.commits.catch(() => undefined);
  }

  /** One commit at a time; a failed commit never poisons the queue. */
  private commit<T>(work: () => Promise<T>): Promise<T> {
    const next = this.commits
      .catch(() => undefined)
      .then(() => {
        if (this.closed) throw canvasError('storage_failed', CLOSING);
        return work();
      });
    this.commits = next.catch(() => undefined);
    return next;
  }

  /** Publishes a manifest: durable first, then visible to readers. */
  private async install(manifest: CanvasManifest): Promise<void> {
    await this.files.writeManifest(manifest);
    this.canvases.set(manifest.canvasId, manifest);
  }

  /** Canvas files are kept: detaching a chat only drops the reference. */
  private async detachFrom(appSessionId: string, keep: string | null): Promise<void> {
    for (const manifest of [...this.canvases.values()]) {
      if (manifest.canvasId === keep) continue;
      if (!manifest.attachedAppSessionIds.includes(appSessionId)) continue;
      const next = structuredClone(manifest);
      next.attachedAppSessionIds = next.attachedAppSessionIds.filter((id) => id !== appSessionId);
      next.updatedAt = Date.now();
      await this.install(next);
    }
  }

  private async stageDesigns(
    canvasId: string,
    existing: CanvasManifest | null,
    input: CreateFramesInput,
  ): Promise<PersistedDesign[]> {
    const origin = nextOrigin(existing?.designs ?? []);
    const designs: PersistedDesign[] = [];
    let x = origin.x;
    for (const frame of input.frames) {
      const designId = randomUUID();
      const revisionId = await this.stageSeed(canvasId, existing, designId, frame);
      designs.push({
        designId,
        name: frame.name,
        rect: { x, y: origin.y, width: frame.width, height: frame.height },
        layoutVersion: 0,
        revisionId,
        designSystem: frame.designSystem,
      });
      x += frame.width + FRAME_GAP_PX;
    }
    return designs;
  }

  /** A seeded frame owns an independent copy of the seed's source tree. */
  private async stageSeed(
    canvasId: string,
    existing: CanvasManifest | null,
    designId: string,
    frame: CreateFramesInput['frames'][number],
  ): Promise<string | null> {
    const seed = frame.seed;
    if (!seed) return null;
    if (seed.kind === 'library')
      throw canvasError('invalid_input', 'Seeding from the library is not available yet.');
    if (existing === null || seed.canvasId !== canvasId)
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

  private currentSource(canvasId: string, design: PersistedDesign): Promise<Map<string, string>> {
    const revisionId = design.revisionId;
    if (revisionId === null) return Promise.resolve(new Map<string, string>());
    return this.files.readRevision(canvasId, { designId: design.designId, revisionId });
  }

  private requireActiveScope(scope: CanvasScope): void {
    if (!this.deps.isScopeActive(scope.scopeId)) throw canvasError('scope_expired', EXPIRED_TURN);
  }

  /** The canvas a lease authorizes; a lease for a canvas we do not hold is stale. */
  private requireScopedCanvas(scope: CanvasScope): CanvasManifest {
    this.requireActiveScope(scope);
    const manifest = this.canvases.get(scopeCanvasId(scope));
    if (!manifest)
      throw canvasError(
        'scope_expired',
        'That request names a canvas this workspace does not hold.',
      );
    return manifest;
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
    const manifest = this.canvases.get(canvasId);
    if (!manifest) throw canvasError('invalid_input', 'That canvas is not open.');
    return manifest;
  }

  private design(manifest: CanvasManifest, designId: string): PersistedDesign {
    const design = manifest.designs.find((entry) => entry.designId === designId);
    if (!design) throw canvasError('invalid_input', 'That frame is not on this canvas.');
    return design;
  }

  private nextCanvasName(): string {
    return `Canvas ${String(this.canvases.size + 1)}`;
  }
}

function scopeCanvasId(scope: CanvasScope): string {
  const canvasId = scope.canvasId;
  if (canvasId === null)
    throw canvasError('invalid_input', 'This chat has no canvas yet. Create a frame first.');
  return canvasId;
}

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
function nextOrigin(designs: readonly PersistedDesign[]): { x: number; y: number } {
  if (designs.length === 0) return { x: 0, y: 0 };
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  for (const design of designs) {
    right = Math.max(right, design.rect.x + design.rect.width);
    top = Math.min(top, design.rect.y);
  }
  return { x: right + FRAME_GAP_PX, y: top };
}
