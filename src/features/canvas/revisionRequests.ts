// A design's revision history (spec §9): the newest page of its commits, and
// switching the frame to show one of them, which adds no revision.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type {
  CanvasCommand,
  SwitchRevisionInput,
  RevisionPage,
  RevisionSummary,
  WriteReceipt,
} from './protocol';

export class RevisionRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  /** Newest first; `page.before` is the exclusive sequence cursor for older ones. */
  async list(canvasId: string, designId: string, page: RevisionPage): Promise<RevisionSummary[]> {
    const event = await this.send({
      type: 'canvas.listRevisions',
      requestId: requestId(),
      canvasId,
      designId,
      page,
    });
    return reply(event, 'revisions').revisions;
  }

  /** Fails with `revision_conflict` when the head moved off `input.expectedRevisionId`. */
  async switchTo(
    appSessionId: string,
    canvasId: string,
    input: SwitchRevisionInput,
  ): Promise<WriteReceipt> {
    const event = await this.send({
      type: 'canvas.switchRevision',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'written').receipt;
  }
}
