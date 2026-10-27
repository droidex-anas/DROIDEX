// The local library's requests (spec §7), correlated by the Canvas client like
// any other. Library items are global, so only a save names a canvas.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type { CanvasCommand, CreateFramesInput, LibraryItem, RevisionRef } from './protocol';

/** The new frame an item makes: an independent copy at the size it was saved with. */
export function libraryFrame(item: LibraryItem): CreateFramesInput['frames'][number] {
  return {
    name: item.name,
    width: item.width,
    height: item.height,
    designSystem: item.designSystem,
    seed: { kind: 'library', itemId: item.itemId },
  };
}

export class LibraryRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  /**
   * `mutationId` names the item; reuse it to retry a save whose answer was lost.
   * `thumbnail` is a base64 PNG of the revision, or null to save without one.
   */
  async save(
    mutationId: string,
    canvasId: string,
    revision: RevisionRef,
    name: string,
    thumbnail: string | null,
  ): Promise<LibraryItem> {
    const event = await this.send({
      type: 'canvas.saveLibraryItem',
      requestId: requestId(),
      mutationId,
      canvasId,
      revision,
      name,
      ...(thumbnail === null ? {} : { thumbnail }),
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

  /** The item's own thumbnail as a base64 PNG, or null when it was saved without one. */
  async thumbnail(itemId: string): Promise<string | null> {
    const event = await this.send({
      type: 'canvas.readLibraryThumbnail',
      requestId: requestId(),
      itemId,
    });
    return reply(event, 'libraryThumbnail').png;
  }
}
