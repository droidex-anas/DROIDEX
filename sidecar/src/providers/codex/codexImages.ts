// A generated image only survives a restart as a file: the transcript keeps the
// path, and the renderer loads it through the app's local image scheme. Codex
// either saved the file itself (`savedPath`) or handed back the bytes encoded in
// `result`, so this settles on one copy inside the profile either way.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { providerSessionsDir } from '../../droidexPaths.js';
import { errMsg } from '../../sessionHelpers.js';

export interface GeneratedImage {
  id: string;
  result: string;
  savedPath?: string | null;
  failure?: { type: string } | null;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
// The first bytes of the formats Codex can return, so a `result` that is not an
// image is reported instead of written out as a file nothing can open. A RIFF
// container is only WebP when it says so at offset 8; the same header fronts
// WAV and AVI.
const SIGNATURES: { extension: string; bytes: number[]; at?: number }[] = [
  { extension: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { extension: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { extension: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { extension: '.webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { extension: '.webp', bytes: [0x57, 0x45, 0x42, 0x50], at: 8 },
];

// The saved file's path, or the line to show in its place when there is no
// image to show.
export function generatedImage(appSessionId: string, item: GeneratedImage): string {
  if (item.failure) return failureText(item.failure.type);
  try {
    return item.savedPath
      ? copied(appSessionId, item.savedPath, item)
      : decoded(appSessionId, item);
  } catch (error) {
    return `Could not save the generated image: ${errMsg(error)}`;
  }
}

function copied(appSessionId: string, savedPath: string, item: GeneratedImage): string {
  const extension = extname(savedPath).toLowerCase();
  const target = imagePath(
    appSessionId,
    item.id,
    IMAGE_EXTENSIONS.has(extension) ? extension : '.png',
  );
  copyFileSync(savedPath, target);
  return target;
}

function decoded(appSessionId: string, item: GeneratedImage): string {
  const bytes = Buffer.from(item.result, 'base64');
  const extension = imageExtension(bytes);
  if (!extension) return 'Codex returned no image for this request.';
  const target = imagePath(appSessionId, item.id, extension);
  writeFileSync(target, bytes);
  return target;
}

// The extension the bytes themselves call for, or undefined when they are not
// an image this build can show.
function imageExtension(bytes: Buffer): string | undefined {
  const matches = (signature: (typeof SIGNATURES)[number]) =>
    signature.bytes.every((byte, index) => bytes[(signature.at ?? 0) + index] === byte);
  const riff = SIGNATURES.find((signature) => signature.at === undefined && matches(signature));
  if (riff?.extension !== '.webp') return riff?.extension;
  // RIFF alone is a container, not a picture.
  return SIGNATURES.some((signature) => signature.at === 8 && matches(signature))
    ? '.webp'
    : undefined;
}

function imagePath(appSessionId: string, itemId: string, extension: string): string {
  const directory = join(providerSessionsDir(), 'images');
  mkdirSync(directory, { recursive: true });
  return join(directory, `${safe(appSessionId)}-${safe(itemId)}${extension}`);
}

// The id reaches a file name, so anything outside this set is replaced rather
// than allowed to walk out of the directory.
function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function failureText(type: string): string {
  return type === 'usageLimitExceeded'
    ? 'Image generation is over its usage limit on this account.'
    : `Image generation failed (${type}).`;
}
