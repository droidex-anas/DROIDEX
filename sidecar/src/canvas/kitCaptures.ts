// The pictures of a kit version's previews: its cover and each preview, per
// mode, captured by the document from a live preview or, for an image cover,
// drawn from that image. They are pixels of immutable source, so they sit
// beside the version rather than in it, and a later capture replaces one
// (design system documents spec §3). The same atomic write as a canvas cover,
// with room for device pixels at the cover's full size.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { imageMediaType } from './canvasAssets.js';
import { canvasError, storageFailure } from './canvasError.js';
import { capturePath, isMissing, refuseLinkedPath } from './designSystemStorage.js';
import { readDesignSystem } from './designSystems.js';
import { kitExample } from './kitPreviews.js';
import type { DesignSystemRef } from './protocol.js';

// A 1200 × 480 cover at 2x is 2400 × 960 pixels; a busy one needs more than a canvas cover's 512 KiB.
const MAX_KIT_CAPTURE_BYTES = 2 * 1024 * 1024;
export const MAX_KIT_CAPTURE_BASE64_LENGTH = Math.ceil(MAX_KIT_CAPTURE_BYTES / 3) * 4;

const NOT_PNG = 'A preview capture must be a PNG.';
const SAVE_RECOVERY = 'The preview capture could not be saved.';
const READ_RECOVERY = 'The preview capture could not be read.';

/** Keeps a capture of a preview that version has; `item` names it as `readKitPreview` does. */
export async function saveKitCapture(
  ref: DesignSystemRef,
  item: string,
  png: Buffer,
): Promise<void> {
  if (imageMediaType(png) !== 'image/png') throw canvasError('invalid_input', NOT_PNG);
  const system = await readDesignSystem(ref);
  if (item !== 'cover' || system.cover?.kind !== 'image') kitExample(system, item);
  const target = capturePath(ref, item);
  // An orphaned `.tmp` costs only its bytes: nothing reads a name it did not ask for.
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await refuseLinkedPath(target);
    await mkdir(dirname(target), { recursive: true });
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
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

/** The capture, or null when that preview has not rendered live in that mode yet. */
export async function readKitCapture(ref: DesignSystemRef, item: string): Promise<Buffer | null> {
  const target = capturePath(ref, item);
  try {
    await refuseLinkedPath(target);
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_KIT_CAPTURE_BYTES)
        throw canvasError('storage_failed', READ_RECOVERY);
      const png = await file.readFile();
      if (imageMediaType(png) !== 'image/png') throw canvasError('storage_failed', READ_RECOVERY);
      return png;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isMissing(error)) return null;
    throw storageFailure(READ_RECOVERY, error);
  }
}
