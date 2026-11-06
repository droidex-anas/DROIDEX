// Variant sets (spec §4): a source frame and the frames made as its variants.
// A source's set takes one piece of work at a time, making variants or using
// one, so two requests cannot number their variants alike and the toolbar can
// hold its buttons meanwhile. Using a variant writes its source over the source
// frame's, checked against the head the user saw, as one step of the board's
// history. The toast saying so offers to remove the set's variants, which is a
// deletion step of its own.

import { dismissToast, pushToast, toast } from '../../lib/toast';
import { revisionEntry, type BoardHistory } from './boardHistory';
import { CanvasRequestError, canvasMessage, type CanvasClient } from './client';
import type { FrameRemovals } from './frameRemovals';
import type { CanvasFrame } from './protocol';
import type { RevisionRequests } from './revisionRequests';
import type { SourceRequests } from './sourceRequests';

/** How long the offer to remove the variants stays up, before hovering or focus pauses it. */
const OFFER_MS = 8000;

/** What a source frame's variant set is busy with. */
export type VariantWork = 'making' | 'using';

/** The variant work on one canvas's source frames, as the toolbar reads it. */
export interface VariantWorkView {
  subscribe: (listener: () => void) => () => void;
  of: (designId: string) => VariantWork | null;
}

interface VariantClient {
  source: Pick<SourceRequests, 'read' | 'write'>;
  revisions: Pick<RevisionRequests, 'switchTo'>;
  snapshotOf: CanvasClient['snapshotOf'];
}

/**
 * The frame `variant` was made from, when using the variant can replace its
 * design: the variant's head is its own work rather than the copy it started
 * as, a working build shows that head, and the source is on the board with a
 * revision that Undo can go back to.
 */
export function variantSetSource(
  frames: readonly CanvasFrame[],
  variant: CanvasFrame,
): CanvasFrame | null {
  if (variant.variantOf === null || !showsOwnWork(variant)) return null;
  const source = frames.find((frame) => frame.designId === variant.variantOf);
  return source?.revisionId ? source : null;
}

function showsOwnWork({ revisionId, seededRevisionId, build }: CanvasFrame): boolean {
  return (
    revisionId !== seededRevisionId && build.status === 'ready' && build.revisionId === revisionId
  );
}

export class VariantSets {
  /** By `canvasId designId`, the work under way on each source frame. */
  private readonly work = new Map<string, VariantWork>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: VariantClient,
    private readonly history: BoardHistory,
    private readonly removals: Pick<FrameRemovals, 'remove'>,
  ) {}

  viewOf(canvasId: string): VariantWorkView {
    return {
      subscribe: this.subscribe,
      of: (designId) => this.work.get(workKey(canvasId, designId)) ?? null,
    };
  }

  /** Runs `request` for variants of `designId` unless its set is busy. */
  async make(canvasId: string, designId: string, request: () => Promise<void>): Promise<void> {
    const key = workKey(canvasId, designId);
    if (!this.begin(key, 'making')) return;
    try {
      await request();
    } finally {
      this.end(key);
    }
  }

  /**
   * Writes `variant`'s source over `source`'s as one step of the board's
   * history, then offers to remove the set's variants. Resolves false when
   * nothing was written, after saying why.
   */
  async apply(
    appSessionId: string,
    canvasId: string,
    variant: CanvasFrame,
    source: CanvasFrame,
  ): Promise<boolean> {
    const chosen = variant.revisionId;
    const before = source.revisionId;
    const key = workKey(canvasId, source.designId);
    if (chosen === null || before === null || !this.begin(key, 'using')) return false;
    try {
      await this.history.recording(canvasId, async () => {
        const [files, replaced] = await Promise.all([
          this.client.source.read(canvasId, variant.designId, chosen),
          this.client.source.read(canvasId, source.designId, before),
        ]);
        const receipt = await this.client.source.write(appSessionId, canvasId, {
          mutationId: crypto.randomUUID(),
          designId: source.designId,
          expectedRevisionId: before,
          files,
          deletedPaths: Object.keys(replaced).filter((path) => !Object.hasOwn(files, path)),
          designSystem: variant.designSystem,
        });
        const offer = this.offerRemoval(appSessionId, canvasId, source, variant);
        const entry = revisionEntry(
          (input) => this.client.revisions.switchTo(appSessionId, canvasId, input),
          source,
          before,
          receipt.revisionId,
        );
        this.history.record(canvasId, {
          ...entry,
          label: `using ${variant.name}`,
          // Once the choice is taken back, clearing the set it came from is no longer the next step.
          undo: async () => {
            const undone = await entry.undo();
            if (undone) dismissToast(offer);
            return undone;
          },
        });
      });
      return true;
    } catch (error) {
      toast.error(`Couldn’t use ${variant.name}. ${failure(error, source)}`);
      return false;
    } finally {
      this.end(key);
    }
  }

  private readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private begin(key: string, work: VariantWork): boolean {
    if (this.work.has(key)) return false;
    this.work.set(key, work);
    this.publish();
    return true;
  }

  private end(key: string): void {
    this.work.delete(key);
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }

  /** The variants go as they are on the board when the user asks, the used one too. */
  private offerRemoval(
    appSessionId: string,
    canvasId: string,
    source: CanvasFrame,
    variant: CanvasFrame,
  ): number {
    return pushToast(`${source.name} now uses ${variant.name}`, 'info', OFFER_MS, {
      label: 'Remove variants',
      run: () => {
        const frames = this.client.snapshotOf(canvasId)?.frames ?? [];
        const variants = frames.filter((frame) => frame.variantOf === source.designId);
        if (variants.length > 0) void this.removals.remove(appSessionId, canvasId, variants);
      },
    });
  }
}

function workKey(canvasId: string, designId: string): string {
  return `${canvasId} ${designId}`;
}

function failure(error: unknown, source: CanvasFrame): string {
  if (error instanceof CanvasRequestError && error.code === 'revision_conflict')
    return `${source.name} changed since. Try again.`;
  return canvasMessage(error);
}
