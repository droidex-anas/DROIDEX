// The live head of every canvas: which manifest is current, how a replacement
// becomes durable before it becomes visible, and what happens to a canvas whose
// head can no longer be read. The workspace owns commits and authorization; the
// error vocabulary its callers see belongs there too.

import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';

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
      const load = await files.loadManifest(canvasId);
      if (load.state === 'missing') continue;
      if (load.state === 'damaged') {
        // Left untouched on disk: repairing it here would be a guess, and one
        // unreadable board must not keep the others closed.
        console.error(`Canvas ${canvasId} was not opened because ${load.reason}.`);
        damaged.add(canvasId);
        continue;
      }
      await files.removeTemporaries(canvasId);
      heads.set(canvasId, load.manifest);
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
   * Rereads one canvas after a save whose outcome is unknown. A head that
   * cannot be reread is held damaged until the workspace is reopened, because
   * serving either the old or the new one would be a guess.
   */
  private async reread(canvasId: string): Promise<void> {
    try {
      const load = await this.files.loadManifest(canvasId);
      if (load.state === 'loaded') {
        this.heads.set(canvasId, load.manifest);
        return;
      }
      const reason = load.state === 'damaged' ? load.reason : 'its manifest is gone';
      console.error(`Canvas ${canvasId} could not be reread because ${reason}.`);
    } catch (error) {
      console.error(`Canvas ${canvasId} could not be reread:`, error);
    }
    this.heads.delete(canvasId);
    this.damaged.add(canvasId);
  }
}
