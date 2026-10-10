// The Manage design systems dialog's requests, correlated by the Canvas client
// like any other. Kits are global, so none of them names a canvas.

import { reply, type ReplyEvent } from './canvasReply';
import type {
  CanvasCommand,
  CanvasDiagnostic,
  DesignSystemDetail,
  DesignSystemSource,
  DesignSystemSummary,
  DesignSystemVersionRef,
} from './protocol';

export interface SavedDesignSystem {
  ref: DesignSystemVersionRef;
  diagnostics: CanvasDiagnostic[];
}

export class DesignSystemRequests {
  constructor(private readonly send: (command: CanvasCommand) => Promise<ReplyEvent>) {}

  async list(): Promise<DesignSystemSummary[]> {
    const event = await this.send({ type: 'canvas.listDesignSystems', requestId: requestId() });
    return reply(event, 'designSystems').systems;
  }

  async read(ref: DesignSystemVersionRef): Promise<DesignSystemDetail> {
    const event = await this.send({ type: 'canvas.readDesignSystem', requestId: requestId(), ref });
    return reply(event, 'designSystem').system;
  }

  /** `mutationId` names the copy; reuse it to retry a save whose answer was lost. */
  async copy(
    mutationId: string,
    source: DesignSystemVersionRef,
    name: string,
  ): Promise<SavedDesignSystem> {
    const event = await this.send({
      type: 'canvas.copyDesignSystem',
      requestId: requestId(),
      mutationId,
      source,
      name,
    });
    const { ref, diagnostics } = reply(event, 'designSystemSaved');
    return { ref, diagnostics };
  }

  /** `mutationId` names the new kit, as for `copy`. */
  async import(
    mutationId: string,
    name: string,
    source: DesignSystemSource,
  ): Promise<SavedDesignSystem> {
    const event = await this.send({
      type: 'canvas.importDesignSystem',
      requestId: requestId(),
      mutationId,
      name,
      source,
    });
    const { ref, diagnostics } = reply(event, 'designSystemSaved');
    return { ref, diagnostics };
  }
}

function requestId(): string {
  return crypto.randomUUID();
}
