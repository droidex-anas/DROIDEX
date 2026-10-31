// Frame creation shares the workspace commit queue and manifest with source
// writes. An unattached lease's first create also mints its canvas and the
// chat's attachment in the same commit (spec §6).

import { randomUUID } from 'node:crypto';
import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasAttachments } from './canvasAttachments.js';
import type { CanvasCommits } from './canvasCommits.js';
import { canvasError } from './canvasError.js';
import type { CanvasFiles } from './canvasFiles.js';
import { placeFrames, requireSeedFrames, stageFrames } from './canvasFrames.js';
import { UNREADABLE_CANVAS, type CanvasHeads } from './canvasHeads.js';
import type { CanvasLeases } from './canvasLeases.js';
import { recordRevisions } from './canvasRevisionMetadata.js';
import {
  canvasChange,
  emptyCanvasManifest,
  mutationFingerprint,
  recordMutation,
  toFrame,
  type CanvasManifest,
} from './canvasManifest.js';
import { recordedCreate } from './canvasReceipts.js';
import type { CanvasScope, CreateFramesInput, CreateFramesResult } from './protocol.js';

const ATTACHED_SINCE = 'This chat was attached to a canvas after that request.';

export class CanvasFrameCreation {
  constructor(
    private readonly files: CanvasFiles,
    private readonly root: string,
    private readonly heads: CanvasHeads,
    private readonly leases: CanvasLeases,
    private readonly attachments: CanvasAttachments,
    private readonly builds: CanvasBuilds,
    private readonly commits: CanvasCommits,
  ) {}

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
      const staged = await stageFrames(this.files, this.root, canvasId, input);

      return this.commits.publish(async () => {
        let next: CanvasManifest;
        let beforeRename: () => void;
        if (bootstrapping) {
          const attached = this.heads.attachedCanvasId(scope.appSessionId);
          if (attached !== null) {
            const recorded = recordedCreate(
              this.attachedCanvas(attached),
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
            if (this.heads.attachedCanvasId(scope.appSessionId) !== null)
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
        recordRevisions(next, scope, 'create', designs);
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
          if (
            scope.canvasId === null &&
            this.heads.attachedCanvasId(scope.appSessionId) === canvasId
          )
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

  private attachedCanvas(canvasId: string): CanvasManifest {
    const manifest = this.heads.find(canvasId);
    if (manifest) return manifest;
    if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
    throw canvasError('invalid_input', 'That canvas is not open.');
  }
}
