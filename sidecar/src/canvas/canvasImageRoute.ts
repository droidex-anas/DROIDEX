import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  canvasImageImportSchema,
  chosenImageSchema,
  type CanvasImageImport,
  type ChosenImage,
} from './canvasAssets.js';
import { CanvasCommandError } from './canvasError.js';
import { sanitiseSvg } from './canvasSvg.js';
import type { OwnedAsset } from './protocol.js';

/** A vector design's markup, as the preview reporter caps it. */
const MAX_SANITISED_SVG_BYTES = 256 * 1024;

export interface CanvasImages {
  secret: string;
  importImage: (request: CanvasImageImport) => Promise<OwnedAsset>;
  importKitImage: (request: ChosenImage) => Promise<OwnedAsset>;
}

/**
 * Main's routes for an image the user chose, into a canvas or into the kit
 * store, and for a design's own SVG on its way to a file the user chose: only
 * its sanitised rebuild goes back.
 */
export function serveCanvasImages(
  req: IncomingMessage,
  res: ServerResponse,
  images: CanvasImages | undefined,
): boolean {
  const routes = ['/canvas/import-image', '/canvas/import-kit-image', '/canvas/sanitise-svg'];
  if (!req.url || !routes.includes(req.url)) return false;
  if (!images || req.headers['x-canvas-secret'] !== images.secret) {
    res.writeHead(401).end('unauthorized');
    return true;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed');
    return true;
  }
  const { url } = req;

  void (async () => {
    try {
      if (url === '/canvas/sanitise-svg') {
        const { bytes } = sanitiseSvg(await body(req, MAX_SANITISED_SVG_BYTES));
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
        res.end(bytes);
        return;
      }
      const request: unknown = JSON.parse((await body(req, 8192)).toString('utf8'));
      const asset =
        url === '/canvas/import-kit-image'
          ? await images.importKitImage(parsed(chosenImageSchema.safeParse(request)))
          : await images.importImage(parsed(canvasImageImportSchema.safeParse(request)));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(asset));
    } catch (error) {
      const failure =
        error instanceof CanvasCommandError
          ? { code: error.code, message: error.message }
          : { code: 'invalid_input', message: 'The image could not be imported. Choose it again.' };
      res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(failure));
    }
  })();
  return true;
}

async function body(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > limitBytes) throw new Error('request too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parsed<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new Error('invalid image import request');
  return result.data;
}
