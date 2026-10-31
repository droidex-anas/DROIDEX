// A canvas's cover: the picture of its first frame that its card on the Design
// home shows. Only a live preview has pixels, so the pane captures it and the
// sidecar keeps it beside the manifest, where deleting the canvas takes it too.
// A later capture replaces it, and a canvas without one shows a plain card.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { imageMediaType } from './canvasAssets.js';
import { canvasError, storageFailure } from './canvasError.js';

/** The pane saves a downscaled capture, so a cover stays small. */
export const MAX_COVER_BYTES = 512 * 1024;
export const MAX_COVER_BASE64_LENGTH = Math.ceil(MAX_COVER_BYTES / 3) * 4;

const COVER_FILE = 'cover.png';
const NOT_PNG = 'A canvas cover must be a PNG.';
const SAVE_RECOVERY = 'The canvas cover could not be saved.';
const READ_RECOVERY = 'The canvas cover could not be read.';

export async function saveCanvasCover(root: string, canvasId: string, png: Buffer): Promise<void> {
  if (imageMediaType(png) !== 'image/png') throw canvasError('invalid_input', NOT_PNG);
  const canvas = join(root, canvasId);
  // A reopened canvas sweeps `.tmp` files, should a save stop halfway.
  const temporary = join(canvas, `${COVER_FILE}.${randomUUID()}.tmp`);
  try {
    await requireCanvasDirectory(canvas, SAVE_RECOVERY);
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(png);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(canvas, COVER_FILE));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

/** The canvas's cover PNG, or null when the pane has not saved one yet. */
export async function readCanvasCover(root: string, canvasId: string): Promise<Buffer | null> {
  const canvas = join(root, canvasId);
  try {
    await requireCanvasDirectory(canvas, READ_RECOVERY);
    const file = await open(join(canvas, COVER_FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_COVER_BYTES)
        throw canvasError('storage_failed', READ_RECOVERY);
      const png = await file.readFile();
      if (imageMediaType(png) !== 'image/png') throw canvasError('storage_failed', READ_RECOVERY);
      return png;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null;
    throw storageFailure(READ_RECOVERY, error);
  }
}

async function requireCanvasDirectory(canvas: string, recovery: string): Promise<void> {
  const info = await lstat(canvas);
  if (!info.isDirectory() || info.isSymbolicLink()) throw canvasError('storage_failed', recovery);
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
