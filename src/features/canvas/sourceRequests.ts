// One design's source, correlated by the Canvas client like any other request:
// read an immutable revision, and write a new one from the source drawer.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type { CanvasCommand, SourceFiles, WriteFilesInput, WriteReceipt } from './protocol';

export class SourceRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  /** Reads immutable source without moving the design's head. */
  async read(canvasId: string, designId: string, revisionId: string): Promise<SourceFiles> {
    const event = await this.send({
      type: 'canvas.readSource',
      requestId: requestId(),
      canvasId,
      designId,
      revisionId,
    });
    return reply(event, 'source').files;
  }

  async write(
    appSessionId: string,
    canvasId: string,
    input: WriteFilesInput,
  ): Promise<WriteReceipt> {
    const event = await this.send({
      type: 'canvas.write',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'written').receipt;
  }
}
