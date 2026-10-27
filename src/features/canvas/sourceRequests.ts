// One design's source, correlated by the Canvas client like any other request:
// read an immutable revision, write a new one from the source drawer, and make
// one direct edit to a selected element.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type { EditElementInput, ElementEditResult } from './elementEditProtocol';
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

  /** A retry with the same mutation ID answers the first run's resolution. */
  async editElement(
    appSessionId: string,
    canvasId: string,
    input: EditElementInput,
  ): Promise<ElementEditResult> {
    const event = await this.send({
      type: 'canvas.editElement',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    const { receipt, resolution } = reply(event, 'edited');
    return { receipt, resolution };
  }
}
