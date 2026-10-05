// The live head of every canvas: which manifest is current, how a replacement
// becomes durable before it becomes visible, and what happens to a canvas whose
// head can no longer be read. The workspace owns commits and authorization; the
// error vocabulary its callers see belongs there too.

import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';

/**
 * One canvas's head, or why it will not be served. Nothing on disk is changed
 * by a refusal: a recovery action owns damaged storage, and one unreadable
 * board must not keep the others closed.
 */
async function loadHead(
  files: CanvasFiles,
  canvasId: string,
): Promise<CanvasManifest | 'missing' | 'damaged'> {
  const load = await files.loadManifest(canvasId);
  if (load.state === 'missing') return 'missing';
  if (load.state === 'damaged') {
    console.error(`Canvas ${canvasId} was not opened because ${load.reason}.`);
    return 'damaged';
  }
  try {
    await files.removeTemporaries(canvasId);
  } catch {
    // The cause is already logged where it was raised.
    console.error(`Canvas ${canvasId} was not opened because its storage could not be cleaned.`);
    return 'damaged';
  }
  return load.manifest;
}

export class CanvasHeads {
  private constructor(
    private readonly files: CanvasFiles,
    private readonly heads: Map<string, CanvasManifest>,
    private readonly damaged: Set<string>,
  ) {}

  static async load(files: CanvasFiles): Promise<CanvasHeads> {
    await files.createRoot();
    const heads = new Map<string, CanvasManifest>();
    const damaged = new Set<string>();
    for (const canvasId of await files.listCanvasIds()) {
      const head = await loadHead(files, canvasId);
      if (head === 'missing') continue;
      if (head === 'damaged') damaged.add(canvasId);
      else heads.set(canvasId, head);
    }
    return new CanvasHeads(files, heads, damaged);
  }

  find(canvasId: string): CanvasManifest | undefined {
    return this.heads.get(canvasId);
  }

  all(): CanvasManifest[] {
    return [...this.heads.values()];
  }

  /** Canvases that exist on disk but are not served, for a recovery action. */
  damagedIds(): string[] {
    return [...this.damaged].sort();
  }

  isDamaged(canvasId: string): boolean {
    return this.damaged.has(canvasId);
  }

  /** The canvas a chat works on, or null while the chat is unattached (spec §6). */
  attachedCanvasId(appSessionId: string): string | null {
    for (const manifest of this.heads.values()) {
      if (manifest.attachedAppSessionIds.includes(appSessionId)) return manifest.canvasId;
    }
    return null;
  }

  /**
   * Publishes a manifest: durable first, then visible to readers. `beforeRename`
   * is the caller's last chance to abandon the change, and a failure anywhere
   * else may still have landed the rename, so the head on disk decides what
   * this registry holds next.
   */
  async install(manifest: CanvasManifest, beforeRename: () => void): Promise<void> {
    let abandonment: unknown;
    try {
      await this.files.writeManifest(manifest, () => {
        try {
          beforeRename();
        } catch (error) {
          abandonment = error;
          throw error;
        }
      });
    } catch (error) {
      if (error !== abandonment) await this.reread(manifest.canvasId);
      throw error;
    }
    this.heads.set(manifest.canvasId, manifest);
  }

  /**
   * Rereads one canvas after a save whose outcome is unknown, and completes the
   * flushes that save still owed. Reading the head back only proves it is
   * visible; until its directory entry is durable, serving it would promise a
   * save that a crash could still undo. A head this cannot finish is held
   * damaged until the workspace is reopened.
   */
  private async reread(canvasId: string): Promise<void> {
    try {
      const load = await this.files.loadManifest(canvasId);
      if (load.state === 'loaded') {
        await this.files.flushCanvasEntry(canvasId);
        this.heads.set(canvasId, load.manifest);
        return;
      }
      const reason = load.state === 'damaged' ? load.reason : 'its manifest is gone';
      console.error(`Canvas ${canvasId} could not be reread because ${reason}.`);
    } catch (error) {
      console.error(`Canvas ${canvasId} could not be recovered:`, error);
    }
    this.heads.delete(canvasId);
    this.damaged.add(canvasId);
  }
}
