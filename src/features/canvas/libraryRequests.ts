// The local library's requests (spec §7), correlated by the Canvas client like
// any other. Library items are global, so only a save names a canvas.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type { CanvasCommand, LibraryItem, RevisionRef } from './protocol';

export class LibraryRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  /** `mutationId` names the item; reuse it to retry a save whose answer was lost. */
  async save(
    mutationId: string,
    canvasId: string,
    revision: RevisionRef,
    name: string,
  ): Promise<LibraryItem> {
    const event = await this.send({
      type: 'canvas.saveLibraryItem',
      requestId: requestId(),
      mutationId,
      canvasId,
      revision,
      name,
    });
    return reply(event, 'libraryItem').item;
  }

  /** Items whose name contains `query`, newest first; an empty query lists them all. */
  async list(query: string): Promise<LibraryItem[]> {
    const event = await this.send({
      type: 'canvas.listLibraryItems',
      requestId: requestId(),
      query,
    });
    return reply(event, 'libraryItems').items;
  }
}
