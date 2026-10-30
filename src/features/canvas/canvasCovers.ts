// The picture each canvas's card shows on the Design home: its first working
// frame, captured while its board is open. The sidecar keeps it across runs;
// this window reads each cover once and swaps in any newer one it saves.

import { useEffect, useSyncExternalStore } from 'react';
import { canvasClient } from './canvasClient';
import { onCanvasImageCaptured } from './captureCanvasImage';
import { frameTile } from './frameTile';
import type { CanvasFrame, RevisionRef } from './protocol';

/** About twice a card's width on the home, so a cover stays sharp on a Retina screen. */
const COVER_WIDTH_PX = 480;

// A data URL per canvas, or null once its read found none.
const covers = new Map<string, string | null>();
const reading = new Set<string>();
const listeners = new Set<() => void>();

function show(canvasId: string, png: string | null): void {
  covers.set(canvasId, png === null ? null : `data:image/png;base64,${png}`);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The cover's URL: undefined while it is read, null when the canvas has none yet. */
export function useCanvasCover(canvasId: string): string | null | undefined {
  const cover = useSyncExternalStore(subscribe, () => covers.get(canvasId));
  useEffect(() => {
    if (covers.has(canvasId) || reading.has(canvasId)) return;
    reading.add(canvasId);
    canvasClient
      .readCover(canvasId)
      .then(
        (png) => {
          show(canvasId, png);
        },
        (error: unknown) => {
          console.error('A canvas cover could not be read:', error);
          show(canvasId, null);
        },
      )
      .finally(() => {
        reading.delete(canvasId);
      });
  }, [canvasId]);
  return cover;
}

/** Each new capture of the board's first working frame becomes the canvas's cover. */
export function useCoverCapture(canvasId: string, frames: readonly CanvasFrame[]): void {
  const cover = coverRevision(frames);
  const designId = cover?.designId;
  const revisionId = cover?.revisionId;
  useEffect(() => {
    if (designId === undefined || revisionId === undefined) return;
    const ref = { designId, revisionId };
    return onCanvasImageCaptured(canvasId, ref, () => {
      saveCover(canvasId, ref).catch((error: unknown) => {
        console.error('A canvas cover could not be saved:', error);
      });
    });
  }, [canvasId, designId, revisionId]);
}

function coverRevision(frames: readonly CanvasFrame[]): RevisionRef | null {
  for (const { designId, build } of frames)
    if (build.status === 'ready') return { designId, revisionId: build.revisionId };
  return null;
}

async function saveCover(canvasId: string, ref: RevisionRef): Promise<void> {
  const png = await frameTile(canvasId, ref, COVER_WIDTH_PX);
  if (png === null) return;
  await canvasClient.saveCover(canvasId, png);
  show(canvasId, png);
}
