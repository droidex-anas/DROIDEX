// Chat attachments and explicit creation share the workspace's commit queue.
// Their manifests own both the attachment and the durable creation identity.

import { randomUUID } from 'node:crypto';
import type { CanvasCommits } from './canvasCommits.js';
import { canvasError } from './canvasError.js';
import { UNREADABLE_CANVAS, type CanvasHeads } from './canvasHeads.js';
import { emptyCanvasManifest } from './canvasManifest.js';

export class CanvasAttachments {
  constructor(
    private readonly heads: CanvasHeads,
    private readonly commits: CanvasCommits,
    private readonly isChatKnown: (appSessionId: string) => boolean,
  ) {}

  /**
   * Leave the old canvas first: a crash between the two manifest writes must
   * leave the chat unattached, never attached twice.
   */
  async createCanvas(
    appSessionId: string,
    mutationId: string,
    name?: string,
    isCurrent?: () => boolean,
  ): Promise<{ canvasId: string }> {
    this.requireChat(appSessionId, isCurrent);
    const previous = this.heads.all().find((head) => head.creation?.mutationId === mutationId);
    if (previous) {
      if (previous.creation?.appSessionId !== appSessionId)
        throw canvasError('invalid_input', 'That Canvas mutation ID belongs to another chat.');
      return { canvasId: previous.canvasId };
    }
    await this.detachFrom(appSessionId, null, isCurrent);
    this.requireChat(appSessionId, isCurrent);
    const manifest = emptyCanvasManifest(randomUUID(), name ?? this.nextCanvasName(), Date.now());
    manifest.creation = { mutationId, appSessionId };
    manifest.attachedAppSessionIds.push(appSessionId);
    await this.heads.install(manifest, this.chatGate(appSessionId, isCurrent));
    return { canvasId: manifest.canvasId };
  }

  async attach(appSessionId: string, canvasId: string, isCurrent?: () => boolean): Promise<void> {
    this.requireChat(appSessionId, isCurrent);
    // Refuse an unknown canvas before detaching the chat from its current one.
    const manifest = this.heads.find(canvasId);
    if (!manifest) {
      if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
      throw canvasError('invalid_input', 'That canvas is not open.');
    }
    await this.detachFrom(appSessionId, canvasId, isCurrent);
    this.requireChat(appSessionId, isCurrent);
    const next = structuredClone(manifest);
    if (next.attachedAppSessionIds.includes(appSessionId)) return;
    next.attachedAppSessionIds.push(appSessionId);
    next.updatedAt = Date.now();
    await this.heads.install(next, this.chatGate(appSessionId, isCurrent));
  }

  detach(appSessionId: string): Promise<void> {
    this.requireChat(appSessionId);
    return this.detachFrom(appSessionId, null);
  }

  requireChat(appSessionId: string, isCurrent?: () => boolean): void {
    if (isCurrent && !isCurrent())
      throw canvasError('scope_expired', 'The session closed before its first turn.');
    if (!this.isChatKnown(appSessionId))
      throw canvasError(
        'unknown_chat',
        'This chat no longer exists. Open a saved chat and try again.',
      );
  }

  private chatGate(appSessionId: string, isCurrent?: () => boolean): () => void {
    return () => {
      this.commits.requireOpen();
      this.requireChat(appSessionId, isCurrent);
    };
  }

  nextCanvasName(): string {
    return `Canvas ${String(this.heads.all().length + 1)}`;
  }

  /** Canvas files are kept: detaching a chat only drops the reference. */
  private async detachFrom(
    appSessionId: string,
    keep: string | null,
    isCurrent?: () => boolean,
  ): Promise<void> {
    this.requireChat(appSessionId, isCurrent);
    const attached = this.heads.attachedCanvasId(appSessionId);
    if (attached !== null && attached !== keep && this.heads.isDamaged(attached))
      throw canvasError('storage_failed', UNREADABLE_CANVAS);
    for (const manifest of this.heads.all()) {
      if (manifest.canvasId === keep) continue;
      if (!manifest.attachedAppSessionIds.includes(appSessionId)) continue;
      const next = structuredClone(manifest);
      next.attachedAppSessionIds = next.attachedAppSessionIds.filter((id) => id !== appSessionId);
      next.updatedAt = Date.now();
      await this.heads.install(next, this.chatGate(appSessionId, isCurrent));
      this.requireChat(appSessionId, isCurrent);
    }
  }
}
