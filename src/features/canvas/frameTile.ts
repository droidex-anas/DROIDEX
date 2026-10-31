// A frame's picture for a tile: the top of its latest capture in 16:10. Main
// holds captures only in memory for this app run, so a picture that has to
// outlive the run, a library item's or a canvas's cover, is copied from here.

import { readCanvasThumbnail } from '../../lib/desktop';
import { base64 } from './captureCanvasImage';
import type { RevisionRef } from './protocol';
import { MAX_TILE_BASE64_LENGTH } from './wireValidation';

/** Five times a library picker row's 64 px tile. */
export const LIBRARY_THUMBNAIL_WIDTH_PX = 320;
const TILE_ASPECT = 16 / 10;

/**
 * The top of the revision's capture as a base64 PNG at most `widthPx` wide and
 * cut to the tile's shape, or null when main holds no capture of it.
 */
export async function frameTile(
  canvasId: string,
  revision: RevisionRef,
  widthPx: number,
): Promise<string | null> {
  const png = await readCanvasThumbnail(canvasId, revision.designId, revision.revisionId);
  if (!png) return null;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }));
  try {
    const scale = Math.min(1, widthPx / bitmap.width);
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
    return encoded.length <= MAX_TILE_BASE64_LENGTH ? encoded : null;
  } finally {
    bitmap.close();
  }
}
