// The live head of every canvas: which manifest is current, how a replacement
// becomes durable before it becomes visible, and what happens to a canvas whose
// head can no longer be read. The workspace owns commits and authorization; the
// error vocabulary its callers see belongs there too.

import type { CanvasFiles } from './canvasFiles.js';
import { outdatedManifest, type CanvasManifest } from './canvasManifest.js';

/** What every caller says about a head it holds but will not serve. */
export const UNREADABLE_CANVAS = 'That canvas could not be read. Reopen DROIDEX to recover it.';

export class CanvasHeads {
  private readonly heads = new Map<string, CanvasManifest>();
  private readonly damaged = new Set<string>();
  // Which canvas each chat is attached to. Separate from the heads because a
  // canvas that cannot be served still holds its attachments on disk, and a
  // chat that looks unattached would be given a second canvas to attach to.
  private readonly attachments = new Map<string, string>();
  // The name of the canvas an earlier DROIDEX made for a chat, which this one
  // will not open. Not an attachment: the chat may start a new canvas.
  private readonly outdated = new Map<string, string>();

  private constructor(private readonly files: CanvasFiles) {}

  /**
   * Opens every canvas under the root. A head that cannot be read or cleaned is
   * left untouched on disk and not served: repairing it here would be a guess,
   * and one unreadable board must not keep the others closed.
   */
  static async load(files: CanvasFiles): Promise<CanvasHeads> {
    await files.createRoot();
    const canvasHeads = new CanvasHeads(files);
    for (const canvasId of await files.listCanvasIds()) {
      const load = await files.loadManifest(canvasId);
      if (load.state === 'missing') continue;
      if (load.state === 'damaged') {
        const outdated = outdatedManifest(load.written, canvasId);
        if (outdated) {
          console.error(`Canvas ${canvasId} was not opened because an earlier DROIDEX made it.`);
          for (const appSessionId of outdated.attachedAppSessionIds)
            canvasHeads.outdated.set(appSessionId, outdated.name);
          continue;
        }
        console.error(`Canvas ${canvasId} was not opened because ${load.reason}.`);
        canvasHeads.damaged.add(canvasId);
        continue;
      }
      // The attachments are known the moment the manifest validates, and they
      // hold whether or not what follows can serve the head.
      canvasHeads.reserve(load.manifest);
      try {
        await files.removeTemporaries(canvasId);
      } catch {
        // The cause is already logged where it was raised.
        console.error(
          `Canvas ${canvasId} was not opened because its storage could not be cleaned.`,
        );
        canvasHeads.damaged.add(canvasId);
        continue;
      }
      canvasHeads.publish(load.manifest);
    }
    return canvasHeads;
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

  /**
   * The canvas a chat is attached to, or null while it is unattached (spec §6).
   * A damaged canvas still answers here: the attachment is real, so the chat
   * cannot be handed a second canvas while that one is unreadable.
   */
  attachedCanvasId(appSessionId: string): string | null {
    return this.attachments.get(appSessionId) ?? null;
  }

  /** The canvas an earlier DROIDEX made for a chat that has none of its own now. */
  outdatedCanvasName(appSessionId: string): string | null {
    return this.attachments.has(appSessionId) ? null : (this.outdated.get(appSessionId) ?? null);
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
      if (error !== abandonment) await this.recover(manifest);
      throw error;
    }
    this.publish(manifest);
  }

  /** Makes a head visible, with exactly the attachments it records. */
  private publish(manifest: CanvasManifest): void {
    this.heads.set(manifest.canvasId, manifest);
    this.damaged.delete(manifest.canvasId);
    for (const [appSessionId, canvasId] of [...this.attachments]) {
      if (canvasId === manifest.canvasId) this.attachments.delete(appSessionId);
    }
    this.reserve(manifest);
  }

  /** Holds a head's attachments, whether or not the head itself is served. */
  private reserve(manifest: CanvasManifest): void {
    for (const appSessionId of manifest.attachedAppSessionIds)
      this.attachments.set(appSessionId, manifest.canvasId);
  }

  /**
   * Rereads one canvas after a save whose outcome is unknown, and completes the
   * flushes that save still owed. Reading the head back only proves it is
   * visible; until its directory entry is durable, serving it would promise a
   * save that a crash could still undo. A head this cannot finish is held
   * damaged until the workspace is reopened, and it keeps the attachments it
   * has on disk so no chat is attached twice.
   */
  private async recover(attempted: CanvasManifest): Promise<void> {
    const canvasId = attempted.canvasId;
    const existed = this.heads.has(canvasId);
    // Unless we learn otherwise, assume the save landed: holding an attachment
    // that is not there costs a recovery, letting go of one costs a duplicate.
    let onDisk = true;
    try {
      const load = await this.files.loadManifest(canvasId);
      if (load.state === 'loaded') {
        await this.files.flushCanvasEntry(canvasId);
        this.publish(load.manifest);
        return;
      }
      onDisk = load.state !== 'missing';
      // A canvas this commit would have created never landed: there is nothing
      // to hold back and no attachment to reserve.
      if (!onDisk && !existed) return;
      const reason = load.state === 'damaged' ? load.reason : 'its manifest is gone';
      console.error(`Canvas ${canvasId} could not be reread because ${reason}.`);
    } catch (error) {
      console.error(`Canvas ${canvasId} could not be recovered:`, error);
    }
    this.heads.delete(canvasId);
    this.damaged.add(canvasId);
    if (onDisk) this.reserve(attempted);
  }
}
