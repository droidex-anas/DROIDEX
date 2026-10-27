// Deleting frames from a board and the Undo offered for it. The sidecar keeps
// each removal's tombstone across reopening; this owner only holds the undoId
// while its "Deleted" toast is showing, per canvas, so the offer outlives a
// tab switch but not the app.

import { dismissToast, pushToast, subscribeToasts, toast } from '../../lib/toast';
import { CanvasRequestError, canvasMessage, type CanvasClient } from './client';
import type { CanvasFrame } from './protocol';

/** How long the Undo toast stays up, before hovering or focus pauses it. */
const UNDO_WINDOW_MS = 8000;

type RemovalClient = Pick<CanvasClient, 'removeFrames' | 'undoRemoval'>;

interface Removal {
  appSessionId: string;
  canvasId: string;
  undoId: string;
  frames: CanvasFrame[];
  toastId: number;
}

export class FrameRemovals {
  /** `canvasId designId` for every frame a removal is still being sent for. */
  private readonly sending = new Set<string>();
  /** Per canvas, the removals whose Undo is still offered, newest last. */
  private readonly offered = new Map<string, Removal[]>();
  /** Bumped when a canvas goes away, so answers that arrive after it are dropped. */
  private readonly generations = new Map<string, number>();
  private stopWatchingToasts: (() => void) | null = null;

  constructor(private readonly client: RemovalClient) {}

  /**
   * Deletes `frames` and offers their Undo. Frames already being deleted are
   * not sent again. Resolves true once the sidecar has removed them.
   */
  async remove(appSessionId: string, canvasId: string, frames: CanvasFrame[]): Promise<boolean> {
    const removing = frames.filter((frame) => !this.sending.has(sendingKey(canvasId, frame)));
    if (removing.length === 0) return false;
    const keys = removing.map((frame) => sendingKey(canvasId, frame));
    const generation = this.generationOf(canvasId);
    for (const key of keys) this.sending.add(key);
    try {
      const undoId = await this.client.removeFrames(appSessionId, canvasId, {
        mutationId: crypto.randomUUID(),
        designIds: removing.map((frame) => frame.designId),
      });
      if (this.generationOf(canvasId) !== generation) return false;
      this.offer({ appSessionId, canvasId, undoId, frames: removing });
      return true;
    } catch (error) {
      if (this.generationOf(canvasId) === generation)
        toast.error(`Couldn’t delete ${framesLabel(removing)}. ${canvasMessage(error)}`);
      return false;
    } finally {
      for (const key of keys) this.sending.delete(key);
    }
  }

  /** Undoes the newest removal still offered on `canvasId`; false when there is none. */
  undoLatest(canvasId: string): boolean {
    const latest = this.offered.get(canvasId)?.at(-1);
    if (!latest) return false;
    void this.undo(latest);
    return true;
  }

  /** The canvas was deleted: its offers end and answers still on their way are ignored. */
  forget(canvasId: string): void {
    this.generations.set(canvasId, this.generationOf(canvasId) + 1);
    for (const removal of this.offered.get(canvasId) ?? []) this.take(removal);
  }

  private offer(removed: Omit<Removal, 'toastId'>): void {
    const removal: Removal = {
      ...removed,
      toastId: pushToast(`Deleted ${framesLabel(removed.frames)}`, 'info', UNDO_WINDOW_MS, {
        label: 'Undo',
        run: () => {
          void this.undo(removal);
        },
      }),
    };
    this.offered.set(removal.canvasId, [...(this.offered.get(removal.canvasId) ?? []), removal]);
    this.watchToasts();
  }

  /** Each Undo is tried once: it stops being offered before the request goes out. */
  private async undo(removal: Removal): Promise<void> {
    if (!this.take(removal)) return;
    const generation = this.generationOf(removal.canvasId);
    try {
      await this.client.undoRemoval(removal.appSessionId, removal.canvasId, {
        mutationId: crypto.randomUUID(),
        undoId: removal.undoId,
      });
    } catch (error) {
      if (this.generationOf(removal.canvasId) !== generation) return;
      // Frames are never moved aside to make room; the user decides what goes there.
      if (error instanceof CanvasRequestError && error.code === 'layout_conflict')
        toast.error(`Something now sits where ${formerPlace(removal.frames)}.`);
      else
        toast.error(
          `Couldn’t undo deleting ${framesLabel(removal.frames)}. ${canvasMessage(error)}`,
        );
    }
  }

  /** Ends one offer and its toast; false when it had already ended. */
  private take(removal: Removal): boolean {
    const offers = this.offered.get(removal.canvasId) ?? [];
    if (!offers.includes(removal)) return false;
    this.keepOffers(
      removal.canvasId,
      offers.filter((offer) => offer !== removal),
    );
    dismissToast(removal.toastId);
    return true;
  }

  /** An offer lasts exactly as long as its toast, however long hovering keeps it up. */
  private watchToasts(): void {
    if (this.stopWatchingToasts) return;
    this.stopWatchingToasts = subscribeToasts((shown) => {
      const showing = new Set(shown.map((item) => item.id));
      for (const [canvasId, offers] of this.offered)
        this.keepOffers(
          canvasId,
          offers.filter((offer) => showing.has(offer.toastId)),
        );
      if (this.offered.size > 0) return;
      this.stopWatchingToasts?.();
      this.stopWatchingToasts = null;
    });
  }

  private keepOffers(canvasId: string, offers: Removal[]): void {
    if (offers.length > 0) this.offered.set(canvasId, offers);
    else this.offered.delete(canvasId);
  }

  private generationOf(canvasId: string): number {
    return this.generations.get(canvasId) ?? 0;
  }
}

function sendingKey(canvasId: string, frame: CanvasFrame): string {
  return `${canvasId} ${frame.designId}`;
}

function framesLabel(frames: CanvasFrame[]): string {
  return frames.length === 1 ? frames[0].name : `${String(frames.length)} frames`;
}

function formerPlace(frames: CanvasFrame[]): string {
  return frames.length === 1 ? `${frames[0].name} was` : `those ${framesLabel(frames)} were`;
}
