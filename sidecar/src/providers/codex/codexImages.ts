// A generated image only survives a restart as a file: the transcript keeps the
// path, and the renderer loads it through the app's local image scheme. Codex
// either saved the file itself (`savedPath`) or handed back the bytes encoded in
// `result`, so this settles on one copy inside the profile either way.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { providerSessionsDir } from '../../droidexPaths.js';
import { errMsg } from '../../errors.js';
import { imageExtension } from '../../imageSignature.js';
import { resetAtMillis, UsageLimitError } from '../usageLimit.js';

export interface GeneratedImage {
  id: string;
  result: string;
  savedPath?: string | null;
  failure?: { type: string; resetsAt?: number | null } | null;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
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

export function imageUsageLimit(failure: GeneratedImage['failure']): UsageLimitError | undefined {
  if (failure?.type !== 'usageLimitExceeded') return undefined;
  const resetsAt = resetAtMillis(failure.resetsAt);
  return new UsageLimitError(failureText(failure.type), resetsAt === undefined ? {} : { resetsAt });
}

function failureText(type: string): string {
  return type === 'usageLimitExceeded'
    ? 'Image generation is over its usage limit on this account.'
    : `Image generation failed (${type}).`;
}
