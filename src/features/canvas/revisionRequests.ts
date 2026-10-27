// A design's revision history (spec §9): the newest page of its commits, and
// Restore, which writes an old revision's source as a new head.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type {
  CanvasCommand,
  RestoreRevisionInput,
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
  async restore(
    appSessionId: string,
    canvasId: string,
    input: RestoreRevisionInput,
  ): Promise<WriteReceipt> {
    const event = await this.send({
      type: 'canvas.restoreRevision',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'written').receipt;
  }
}
