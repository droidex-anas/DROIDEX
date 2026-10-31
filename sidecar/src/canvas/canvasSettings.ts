// Canvas-wide settings, committed on the workspace's queue like any manifest
// change and authorized by the asking chat's attachment. Changing how designs are
// held to their kit rebuilds every frame with source, so each frame's build
// answers to the rule the canvas has now.

import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasCommits } from './canvasCommits.js';
import { canvasError } from './canvasError.js';
import { UNREADABLE_CANVAS, type CanvasHeads } from './canvasHeads.js';
import { canvasChange, type CanvasManifest } from './canvasManifest.js';
import type { DesignSystemAdherence } from './protocol.js';

export class CanvasSettings {
  constructor(
    private readonly heads: CanvasHeads,
    private readonly commits: CanvasCommits,
    private readonly builds: CanvasBuilds,
  ) {}

  designSystemAdherence(canvasId: string): DesignSystemAdherence {
    const manifest = this.heads.find(canvasId);
    if (!manifest) throw canvasError('invalid_input', 'That canvas is not open.');
    return manifest.designSystemAdherence;
  }

  setDesignSystemAdherence(
    appSessionId: string,
    canvasId: string,
    rule: DesignSystemAdherence,
  ): Promise<void> {
    return this.commits.admit(() =>
      this.commits.publish(async () => {
        const live = this.attachedCanvas(appSessionId, canvasId);
        if (live.designSystemAdherence === rule) return { value: undefined };
        const next = structuredClone(live);
        next.designSystemAdherence = rule;
        next.sequence += 1;
        next.updatedAt = Date.now();
        await this.heads.install(next, () => {
          this.commits.requireOpen();
          this.attachedCanvas(appSessionId, canvasId);
        });
        for (const design of next.designs) {
          if (design.revisionId !== null)
            this.builds.enqueue(canvasId, design.designId, design.revisionId);
        }
        const rebuilt = next.designs.filter((design) => design.revisionId !== null);
        return { value: undefined, change: canvasChange(next, rebuilt, this.builds) };
      }),
    );
  }

  private attachedCanvas(appSessionId: string, canvasId: string): CanvasManifest {
    if (this.heads.attachedCanvasId(appSessionId) !== canvasId)
      throw canvasError('scope_expired', 'This chat is not attached to that canvas.');
    const manifest = this.heads.find(canvasId);
    // An attached canvas that is not served is one whose head could not be read.
    if (!manifest) throw canvasError('storage_failed', UNREADABLE_CANVAS);
    return manifest;
  }
}
