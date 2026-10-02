// A tool result can carry pictures beside its text: a screenshot, an image file
// the agent read. Each is kept as a file in the profile and the event carries
// its path, so the renderer shows the picture and its base64 never becomes
// transcript text.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { providerSessionsDir } from './droidexPaths.js';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

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
    const image = imageOf(block);
    const path = image && savedImage(image.data, image.mimeType);
    if (path) images.push(path);
    else if (image) text.push('An image this build cannot show.');
    else text.push(textOf(block));
  }
  return { text: text.filter(Boolean).join('\n'), ...(images.length ? { images } : {}) };
}

function textOf(block: unknown): string {
  const text = (block as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : JSON.stringify(block);
}

// An image block comes in MCP's shape (`data`, `mimeType`), the model API's
// (`source.data`, `source.media_type`) or Codex's (`imageUrl`, a data URL).
function imageOf(block: unknown): { data: string; mimeType: string } | undefined {
  const image = block as {
    type?: unknown;
    data?: unknown;
    mimeType?: unknown;
    source?: { data?: unknown; media_type?: unknown };
    imageUrl?: unknown;
  } | null;
  if (image?.type === 'inputImage' && typeof image.imageUrl === 'string') {
    const url = /^data:([^;,]+);base64,(.+)$/s.exec(image.imageUrl);
    return url ? { mimeType: url[1], data: url[2] } : undefined;
  }
  if (image?.type !== 'image') return undefined;
  const data = image.data ?? image.source?.data;
  const mimeType = image.mimeType ?? image.source?.media_type;
  return typeof data === 'string' && typeof mimeType === 'string' ? { data, mimeType } : undefined;
}

// Named by its content, so replaying a session finds the file it wrote before.
function savedImage(data: string, mimeType: string): string | undefined {
  const extension = EXTENSIONS[mimeType.toLowerCase()];
  if (!extension) return undefined;
  try {
    const directory = join(providerSessionsDir(), 'images');
    const name = createHash('sha256').update(data).digest('hex').slice(0, 32);
    const path = join(directory, `tool-${name}${extension}`);
    if (!existsSync(path)) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, Buffer.from(data, 'base64'));
    }
    return path;
  } catch {
    return undefined;
  }
}
