// What the Layers panel changes on the canvas besides names: whether a frame
// shows on the board, and the order frames stack in.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type {
  CanvasChange,
  CanvasCommand,
  ReorderFramesInput,
  SetFrameHiddenInput,
} from './protocol';

export class LayerRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  async setHidden(
    appSessionId: string,
    canvasId: string,
    input: SetFrameHiddenInput,
  ): Promise<CanvasChange> {
    const event = await this.send({
      type: 'canvas.setFrameHidden',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'hiddenSet').change;
  }

  /** Fails with `revision_conflict` unless `input.designIds` names exactly the canvas's frames. */
  async reorder(
    appSessionId: string,
    canvasId: string,
    input: ReorderFramesInput,
  ): Promise<CanvasChange> {
    const event = await this.send({
      type: 'canvas.reorderFrames',
      requestId: requestId(),
      appSessionId,
      canvasId,
      input,
    });
    return reply(event, 'reordered').change;
  }
}
