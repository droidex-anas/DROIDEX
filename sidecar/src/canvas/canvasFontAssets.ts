// Kit WOFF2 data is written once under the app profile and referenced from the
// stylesheet by content ID. The preview host serves it without a network fetch.

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { droidexUserDataDir } from '../droidexPaths.js';

const FONT_URL = /url\(\s*(['"]?)data:font\/woff2;base64,([A-Za-z0-9+/=]+)\1\s*\)/gi;
const MAX_FONT_BYTES = 1024 * 1024;

export async function hostKitFonts(css: string): Promise<string> {
  const matches = [...css.matchAll(FONT_URL)];
  if (matches.length === 0) return css;
  const replacements = new Map<string, string>();
  for (const [reference, , encoded] of matches) {
    const bytes = woff2Bytes(encoded);
    if (!bytes) throw new Error('Kit font is not a valid WOFF2 file of at most 1 MiB.');
    const fontId = createHash('sha256').update(bytes).digest('hex');
    await saveFont(fontId, bytes);
    replacements.set(reference, `url(droidex-canvas-preview://preview/font/${fontId})`);
  }
  return css.replace(FONT_URL, (reference) => replacements.get(reference) ?? reference);
}

/** The base64 of the first valid WOFF2 file an `@font-face` `src` embeds, or null. */
export function embeddedWoff2(src: string): string | null {
  for (const [, , encoded] of src.matchAll(FONT_URL)) if (woff2Bytes(encoded)) return encoded;
  return null;
}

function woff2Bytes(encoded: string): Buffer | null {
  if (encoded.length > 4 * Math.ceil(MAX_FONT_BYTES / 3) || !isBase64(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 4 || bytes.length > MAX_FONT_BYTES) return null;
  return bytes.toString('ascii', 0, 4) === 'wOF2' ? bytes : null;
}

/** Base64 `atob` decodes as `Buffer` does: padding only at the end and a length it can have. */
function isBase64(encoded: string): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  return encoded.endsWith('=') ? encoded.length % 4 === 0 : encoded.length % 4 !== 1;
}

async function saveFont(fontId: string, bytes: Buffer): Promise<void> {
  const directory = join(droidexUserDataDir(), 'canvas-fonts');
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error;
  }
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    throw new Error('The Canvas font store is not a directory.');
  const target = join(directory, fontId);
  try {
    const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await existing.stat();
      if (!info.isFile() || info.size < 1 || info.size > MAX_FONT_BYTES)
        throw new Error('The saved Canvas font is damaged.');
      if (
        createHash('sha256')
          .update(await existing.readFile())
          .digest('hex') !== fontId
      )
        throw new Error('The saved Canvas font is damaged.');
    } finally {
      await existing.close();
    }
    return;
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
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
    if (process.platform !== 'win32') {
      const folder = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
