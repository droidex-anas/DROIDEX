// Whole-canvas deletion (spec §7): the preview the user reviews, and the
// removal that carries that preview back so a canvas changed since is refused.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type { CanvasCommand, CanvasRemovalPreview } from './protocol';

export class RemovalRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  async preview(canvasId: string): Promise<CanvasRemovalPreview> {
    const event = await this.send({
      type: 'canvas.removalPreview',
      requestId: requestId(),
      canvasId,
    });
    return reply(event, 'removalPreview').preview;
  }

  /** Fails with `revision_conflict` when the canvas changed after `reviewed` was read. */
  async remove(reviewed: CanvasRemovalPreview): Promise<void> {
    const event = await this.send({
      type: 'canvas.removeCanvas',
      requestId: requestId(),
      canvasId: reviewed.canvasId,
      expectedSequence: reviewed.sequence,
      expectedAttachedAppSessionIds: reviewed.attachedAppSessionIds,
    });
    reply(event, 'ok');
  }
}
