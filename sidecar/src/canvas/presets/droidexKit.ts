// The DROIDEX preset is the app's own kit, exported from a saved version by
// tools/export-kit.mjs: its document and source in droidex/system.json, and the
// cover and preview captures that version had, which ship beside it so the
// picker and the document show them before anything renders live.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageFailure } from '../canvasError.js';
import { isMissing } from '../designSystemStorage.js';
import type { DesignSystemRef } from '../protocol.js';
import kit from './droidex/system.json' with { type: 'json' };

/** The preset as exported; the built-in list validates it with the other kits. */
export const DROIDEX_KIT: unknown = kit;

// The built sidecar runs from the root of dist, where the build copies this folder to presets/.
const CAPTURES_DIR = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? './droidex/' : './presets/droidex/', import.meta.url),
);

/** The capture the preset ships for `item` in that mode, or null when it ships none. */
export async function bundledKitCapture(
  ref: DesignSystemRef,
  item: string,
): Promise<Buffer | null> {
  if (ref.id !== kit.id || ref.version !== kit.version) return null;
  const file =
    item === 'cover' ? `cover-${ref.mode}.png` : join('previews', `${item}-${ref.mode}.png`);
  try {
    return await readFile(join(CAPTURES_DIR, file));
  } catch (error) {
    if (isMissing(error)) return null;
    throw storageFailure('The preview capture could not be read.', error);
  }
}
