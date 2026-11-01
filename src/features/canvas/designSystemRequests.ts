// The design system requests, correlated by the Canvas client like any other.
// Kits are global, so none of them names a canvas.

import { reply, requestId, type ReplyEvent } from './canvasReply';
import type {
  CanvasCommand,
  CanvasDiagnostic,
  DesignSystemCover,
  DesignSystemDocumentView,
  DesignSystemRef,
  DesignSystemSource,
  DesignSystemSummary,
  DesignSystemVersionEntry,
  DesignSystemVersionRef,
  KitPreview,
} from './protocol';
import type { DocumentSection } from './designSystemDocumentProtocol';

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

  async read(ref: DesignSystemVersionRef): Promise<DesignSystemDocumentView> {
    const event = await this.send({ type: 'canvas.readDesignSystem', requestId: requestId(), ref });
    return reply(event, 'designSystem').system;
  }

  /**
   * Saves the document's edits as the version after `baseVersion`. A base that
   * is no longer the newest fails with `revision_conflict` and its `latestVersion`.
   */
  async save(
    mutationId: string,
    id: string,
    baseVersion: number,
    document: { name: string; cover: DesignSystemCover; sections: DocumentSection[] },
  ): Promise<SavedDesignSystem> {
    const event = await this.send({
      type: 'canvas.saveDesignSystem',
      requestId: requestId(),
      mutationId,
      id,
      baseVersion,
      ...document,
    });
    const { ref, diagnostics } = reply(event, 'designSystemSaved');
    return { ref, diagnostics };
  }

  /** Newest first. */
  async versions(id: string): Promise<DesignSystemVersionEntry[]> {
    const event = await this.send({
      type: 'canvas.listDesignSystemVersions',
      requestId: requestId(),
      id,
    });
    return reply(event, 'designSystemVersions').versions;
  }

  /** Saves `version` again as the version after `onto`, the newest the user saw. */
  async restore(
    mutationId: string,
    id: string,
    version: number,
    onto: number,
  ): Promise<SavedDesignSystem> {
    const event = await this.send({
      type: 'canvas.restoreDesignSystemVersion',
      requestId: requestId(),
      mutationId,
      id,
      version,
      onto,
    });
    const { ref, diagnostics } = reply(event, 'designSystemSaved');
    return { ref, diagnostics };
  }

  /** Takes a user kit out of every list, or puts it back; its versions stay readable. */
  async setDeleted(mutationId: string, id: string, deleted: boolean): Promise<void> {
    const event = await this.send({
      type: 'canvas.setDesignSystemDeleted',
      requestId: requestId(),
      mutationId,
      id,
      deleted,
    });
    reply(event, 'ok');
  }

  /** Saves the agent's proposal as the version after `onto`, the newest the user saw. */
  async acceptProposal(mutationId: string, id: string, onto: number): Promise<SavedDesignSystem> {
    const event = await this.send({
      type: 'canvas.acceptDesignSystemProposal',
      requestId: requestId(),
      mutationId,
      id,
      onto,
    });
    const { ref, diagnostics } = reply(event, 'designSystemSaved');
    return { ref, diagnostics };
  }

  async discardProposal(id: string): Promise<void> {
    const event = await this.send({
      type: 'canvas.discardDesignSystemProposal',
      requestId: requestId(),
      id,
    });
    reply(event, 'ok');
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

  /** `item` is a preview's id, `cover` or `typography`. */
  async readPreview(ref: DesignSystemRef, item: string): Promise<KitPreview> {
    const event = await this.send({
      type: 'canvas.readKitPreview',
      requestId: requestId(),
      ref,
      item,
    });
    return reply(event, 'kitPreview').preview;
  }

  /** `png` is base64; it replaces any earlier capture of that preview and mode. */
  async saveCapture(ref: DesignSystemRef, item: string, png: string): Promise<void> {
    const event = await this.send({
      type: 'canvas.saveKitCapture',
      requestId: requestId(),
      ref,
      item,
      png,
    });
    reply(event, 'ok');
  }

  /** The base64 PNG, or null before that preview first rendered live in that mode. */
  async readCapture(ref: DesignSystemRef, item: string): Promise<string | null> {
    const event = await this.send({
      type: 'canvas.readKitCapture',
      requestId: requestId(),
      ref,
      item,
    });
    return reply(event, 'kitCapture').png;
  }
}
