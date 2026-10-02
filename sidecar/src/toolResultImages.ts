// A tool result can carry pictures beside its text: a screenshot, an image file
// the agent read. Each is kept as a file in the profile and the event carries
// its path, so the renderer shows the picture and its base64 never becomes
// transcript text.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { providerSessionsDir } from './droidexPaths.js';
import { imageExtension } from './imageSignature.js';

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
  source?: { data?: unknown };
  imageUrl?: unknown;
}

function isImage(block: unknown): block is ImageBlock {
  const type = (block as { type?: unknown } | null)?.type;
  return type === 'image' || type === 'inputImage';
}

// An image block carries its bytes in MCP's shape (`data`), the model API's
// (`source.data`) or Codex's (`imageUrl`, a data URL).
function base64Of(image: ImageBlock): string | undefined {
  if (typeof image.imageUrl === 'string')
    return /^data:[^,]*;base64,(.+)$/s.exec(image.imageUrl)?.[1];
  const data = image.data ?? image.source?.data;
  return typeof data === 'string' ? data : undefined;
}

// Named by its content, so replaying a session finds the file it wrote before,
// and typed by its own first bytes, whatever the block called it. Written
// beside its place under a name of its own and moved in, so a write that
// fails, or two that race, leave no half file to be taken for the picture.
function savedImage(image: ImageBlock): string | undefined {
  const data = base64Of(image);
  if (!data || data.length * 0.75 > MAX_IMAGE_BYTES) return undefined;
  const bytes = Buffer.from(data, 'base64');
  const extension = imageExtension(bytes);
  if (!extension) return undefined;
  const directory = join(providerSessionsDir(), 'images');
  const name = createHash('sha256').update(data).digest('hex').slice(0, 32);
  const path = join(directory, `tool-${name}${extension}`);
  if (existsSync(path)) return path;
  const partial = `${path}.${randomUUID()}.part`;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(partial, bytes);
    renameSync(partial, path);
    return path;
  } catch {
    rmSync(partial, { force: true });
    return undefined;
  }
}
