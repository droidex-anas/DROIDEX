import { createHash, createHmac, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { canvasError, CanvasCommandError } from './canvasError.js';
import type { OwnedAsset } from './protocol.js';
import { canvasIdentifierSchema } from './schema.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const IMAGE_RECOVERY = 'Choose a PNG, JPEG or WebP image under 10 MiB and 8192 pixels per side.';

// Main decodes these exact bytes before sending the digest and dimensions over
// its private bridge route. The digest closes the path replacement race.
export const canvasImageImportSchema = z
  .object({
    canvasId: canvasIdentifierSchema,
    filePath: z.string().min(1).max(4096),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(1).max(MAX_DIMENSION),
    height: z.number().int().min(1).max(MAX_DIMENSION),
  })
  .strict();

export type CanvasImageImport = z.infer<typeof canvasImageImportSchema>;

/** The sidecar owns the durable copy; only Electron main may call this route. */
export async function importCanvasImage(
  root: string,
  request: CanvasImageImport,
): Promise<OwnedAsset> {
  if (!isAbsolute(request.filePath))
    throw canvasError('invalid_input', 'Choose an image from your computer first.');

  let bytes: Buffer;
  try {
    const file = await open(request.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw canvasError('invalid_input', 'Choose a regular image file.');
      if (info.size < 1 || info.size > MAX_IMAGE_BYTES)
        throw canvasError('invalid_input', IMAGE_RECOVERY);
      bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (bytesRead === 0)
          throw canvasError('invalid_input', 'The selected image changed. Choose it again.');
        offset += bytesRead;
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof CanvasCommandError) throw error;
    throw canvasError('invalid_input', 'The selected image could not be read. Choose it again.');
  }

  const mediaType = imageMediaType(bytes);
  if (!mediaType) throw canvasError('invalid_input', IMAGE_RECOVERY);
  const assetId = createHash('sha256').update(bytes).digest('hex');
  if (assetId !== request.digest)
    throw canvasError('invalid_input', 'The selected image changed. Choose it again.');
  await saveOwnedAsset(root, request.canvasId, assetId, bytes);
  return {
    assetId,
    mediaType,
    byteLength: bytes.length,
    width: request.width,
    height: request.height,
  };
}

/** Content-addressed, immutable storage, with no links below the profile root. */
async function saveOwnedAsset(root: string, canvasId: string, assetId: string, bytes: Buffer) {
  const canvas = join(root, canvasId);
  const assets = join(canvas, 'assets');
  const target = join(assets, assetId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const canvasInfo = await lstat(canvas);
    if (!canvasInfo.isDirectory() || canvasInfo.isSymbolicLink())
      throw canvasError(
        'storage_failed',
        'Canvas storage is damaged. Reopen DROIDEX to recover it.',
      );
    try {
      await mkdir(assets);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
    }
    const assetsInfo = await lstat(assets);
    if (!assetsInfo.isDirectory() || assetsInfo.isSymbolicLink())
      throw canvasError(
        'storage_failed',
        'Canvas storage is damaged. Reopen DROIDEX to recover it.',
      );

    try {
      const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await existing.stat();
        if (!info.isFile() || info.size < 1 || info.size > MAX_IMAGE_BYTES)
          throw canvasError(
            'storage_failed',
            'That saved image is damaged. Reopen DROIDEX to recover it.',
          );
        if (
          createHash('sha256')
            .update(await existing.readFile())
            .digest('hex') !== assetId
        )
          throw canvasError(
            'storage_failed',
            'That saved image is damaged. Reopen DROIDEX to recover it.',
          );
      } finally {
        await existing.close();
      }
      return;
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw error;
    }

    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    await syncDirectory(assets);
    await syncDirectory(canvas);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof CanvasCommandError) throw error;
    throw canvasError(
      'storage_failed',
      'The image could not be saved. Free disk space and try again.',
    );
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function imageMediaType(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Rewrites only canonical owned references into exact, signed host URLs. */
export function resolveCanvasAssetReferences(
  html: string,
  canvasId: string,
  secret: string,
): string {
  return html.replace(/canvas-asset:([0-9a-f]{64})\b/g, (_reference, assetId: string) => {
    const signature = createHmac('sha256', secret).update(`${canvasId}\0${assetId}`).digest('hex');
    return `droidex-canvas-preview://preview/asset/${canvasId}/${assetId}?sig=${signature}`;
  });
}
