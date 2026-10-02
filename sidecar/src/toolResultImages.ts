// A tool result can carry pictures beside its text: a screenshot, an image file
// the agent read. Each is kept as a file in the profile and the event carries
// its path, so the renderer shows the picture and its base64 never becomes
// transcript text.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { providerSessionsDir } from './droidexPaths.js';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
// The most the app's local image scheme serves (electron/localImages.cjs).
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const UNSHOWN = 'An image this build cannot show.';

export interface ToolResultParts {
  text: string;
  /** Saved image files, in the order the result carried them. */
  images?: string[];
}

/** A tool result's text, and the saved files of the images it carried. */
export function toolResultParts(content: unknown): ToolResultParts {
  if (typeof content === 'string') return { text: content };
  if (!Array.isArray(content))
    return { text: content === undefined ? '' : JSON.stringify(content) };
  const text: string[] = [];
  const images: string[] = [];
  for (const block of content as unknown[]) {
    if (!isImage(block)) {
      text.push(textOf(block));
      continue;
    }
    // An image is a saved file or one plain line, never its own bytes as text.
    const path = savedImage(block);
    if (path) images.push(path);
    else text.push(UNSHOWN);
  }
  return { text: text.join('\n'), ...(images.length ? { images } : {}) };
}

function textOf(block: unknown): string {
  const text = (block as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : JSON.stringify(block);
}

interface ImageBlock {
  type: 'image' | 'inputImage';
  data?: unknown;
  mimeType?: unknown;
  source?: { data?: unknown; media_type?: unknown; mediaType?: unknown };
  imageUrl?: unknown;
}

function isImage(block: unknown): block is ImageBlock {
  const type = (block as { type?: unknown } | null)?.type;
  return type === 'image' || type === 'inputImage';
}

// An image block comes in MCP's shape (`data`, `mimeType`), the model API's
// (`source.data` with `source.media_type`, which the Droid SDK spells
// `mediaType`) or Codex's (`imageUrl`, a data URL).
function bytesOf(image: ImageBlock): { data: string; mimeType: string } | undefined {
  if (typeof image.imageUrl === 'string') {
    const url = /^data:([^;,]+)[^,]*;base64,(.+)$/s.exec(image.imageUrl);
    return url ? { mimeType: url[1], data: url[2] } : undefined;
  }
  const data = image.data ?? image.source?.data;
  const mimeType = image.mimeType ?? image.source?.media_type ?? image.source?.mediaType;
  return typeof data === 'string' && typeof mimeType === 'string' ? { data, mimeType } : undefined;
}

// Named by its content, so replaying a session finds the file it wrote before.
// Written beside its place under a name of its own and moved in, so a write
// that fails, or two that race, leave no half file to be taken for the picture.
function savedImage(image: ImageBlock): string | undefined {
  const bytes = bytesOf(image);
  const extension = bytes && EXTENSIONS[bytes.mimeType.toLowerCase()];
  if (!bytes || !extension || bytes.data.length * 0.75 > MAX_IMAGE_BYTES) return undefined;
  try {
    const directory = join(providerSessionsDir(), 'images');
    const name = createHash('sha256').update(bytes.data).digest('hex').slice(0, 32);
    const path = join(directory, `tool-${name}${extension}`);
    if (!existsSync(path)) {
      mkdirSync(directory, { recursive: true });
      const partial = `${path}.${randomUUID()}.part`;
      writeFileSync(partial, Buffer.from(bytes.data, 'base64'));
      renameSync(partial, path);
    }
    return path;
  } catch {
    return undefined;
  }
}
