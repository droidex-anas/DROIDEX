// Deleting frames from a board. Each deletion is a step in the board's history,
// so Undo takes it back in turn and Redo deletes the frames again; its
// "Deleted" toast offers that Undo while the deletion is the newest step. The
// sidecar keeps each removal's tombstone across reopening.

import { dismissToast, pushToast, toast } from '../../lib/toast';
import { designsLabel, landed, type BoardHistory, type HistoryEntry } from './boardHistory';
import { CanvasRequestError, canvasMessage, type CanvasClient } from './client';
import type { CanvasFrame } from './protocol';

/** How long the Undo toast stays up, before hovering or focus pauses it. */
const UNDO_WINDOW_MS = 8000;

type RemovalClient = Pick<CanvasClient, 'removeFrames' | 'undoRemoval'>;

export class FrameRemovals {
  /** `canvasId designId` for every frame a removal is still being sent for. */
  private readonly sending = new Set<string>();
  /** Per canvas, the toast offering Undo while its newest step is a deletion. */
  private readonly offers = new Map<string, number>();
  /** Bumped when a canvas goes away, so answers that arrive after it are dropped. */
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly client: RemovalClient,
    private readonly history: BoardHistory,
  ) {}

  /**
   * Deletes `frames` as a step in the board's history and offers its Undo.
   * Frames already being deleted are not sent again. Resolves true once the
   * sidecar has removed them.
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
      this.history.record(canvasId, this.deletion(appSessionId, canvasId, removing, undoId));
      this.offerUndo(canvasId, removing);
      return true;
    } catch (error) {
      if (this.generationOf(canvasId) === generation)
        toast.error(`Couldn’t delete ${designsLabel(removing)}. ${canvasMessage(error)}`);
      return false;
    } finally {
      for (const key of keys) this.sending.delete(key);
    }
  }

  /** The canvas was deleted: its Undo offer ends and answers still on their way are ignored. */
  forget(canvasId: string): void {
    this.generations.set(canvasId, this.generationOf(canvasId) + 1);
    this.endOffer(canvasId);
  }

  /** One deletion as a step. Each Redo removes the frames again and keeps that removal's undoId. */
  private deletion(
    appSessionId: string,
    canvasId: string,
    frames: CanvasFrame[],
    removedAs: string,
  ): HistoryEntry {
    let undoId = removedAs;
    const designIds = frames.map((frame) => frame.designId);
    return {
      label: `deleting ${designsLabel(frames)}`,
      designs: frames,
      covered: () => {
        this.endOffer(canvasId);
      },
      undo: async () => {
        this.endOffer(canvasId);
        try {
          await this.client.undoRemoval(appSessionId, canvasId, {
            mutationId: crypto.randomUUID(),
            undoId,
          });
          return true;
        } catch (error) {
          if (!(error instanceof CanvasRequestError)) throw error;
          // Frames are never moved aside to make room; the user decides what goes
          // there, and the step stays so the next Undo can try again.
          if (error.code === 'layout_conflict')
            throw new Error(`Something now sits where ${formerPlace(frames)}.`);
          // The frames are back already, or the canvas no longer keeps this removal.
          if (
            error.code === 'revision_conflict' ||
            error.code === 'invalid_input' ||
            error.code === 'not_found'
          )
            return false;
          throw error;
        }
      },
      redo: () => {
        const removal = this.client.removeFrames(appSessionId, canvasId, {
          mutationId: crypto.randomUUID(),
          designIds,
        });
        return landed(
          removal.then((removedAs) => {
            undoId = removedAs;
          }),
        );
      },
    };
  }

  private offerUndo(canvasId: string, frames: CanvasFrame[]): void {
    this.offers.set(
      canvasId,
      pushToast(`Deleted ${designsLabel(frames)}`, 'info', UNDO_WINDOW_MS, {
        label: 'Undo',
        run: () => {
          this.history.undo(canvasId);
        },
      }),
    );
  }

  private endOffer(canvasId: string): void {
    const toastId = this.offers.get(canvasId);
    if (toastId === undefined) return;
    this.offers.delete(canvasId);
    dismissToast(toastId);
  }

  private generationOf(canvasId: string): number {
    return this.generations.get(canvasId) ?? 0;
  }
}

function sendingKey(canvasId: string, frame: CanvasFrame): string {
  return `${canvasId} ${frame.designId}`;
}

function formerPlace(frames: CanvasFrame[]): string {
  return frames.length === 1 ? `${frames[0].name} was` : `those ${designsLabel(frames)} were`;
}
