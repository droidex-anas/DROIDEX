// A library item keeps its own picture (spec §7). Main holds a frame's latest
// capture only for this app run and only in memory, so a save copies a small
// one into the item, and the item outlives both the run and its canvas.

import { readCanvasThumbnail } from '../../lib/desktop';
import { base64 } from './captureCanvasImage';
import type { RevisionRef } from './protocol';
import { MAX_LIBRARY_THUMBNAIL_BASE64_LENGTH } from './wireValidation';

/** Five times a picker row's 64 px tile, which shows the frame's top in 16:10. */
const THUMBNAIL_WIDTH_PX = 320;
const TILE_ASPECT = 16 / 10;

/**
 * The top of the revision's capture as a base64 PNG at most
 * `THUMBNAIL_WIDTH_PX` wide and cut to the tile's shape, or null when main
 * holds no capture of it.
 */
export async function libraryThumbnail(
  canvasId: string,
  revision: RevisionRef,
): Promise<string | null> {
  const png = await readCanvasThumbnail(canvasId, revision.designId, revision.revisionId);
  if (!png) return null;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }));
  try {
    const scale = Math.min(1, THUMBNAIL_WIDTH_PX / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(
      1,
      Math.min(Math.round(width / TILE_ASPECT), Math.round(bitmap.height * scale)),
    );
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, bitmap.height * scale);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const encoded = base64(new Uint8Array(await blob.arrayBuffer()));
    return encoded.length <= MAX_LIBRARY_THUMBNAIL_BASE64_LENGTH ? encoded : null;
  } finally {
    bitmap.close();
  }
}
