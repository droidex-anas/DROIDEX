import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  canvasImageImportSchema,
  type CanvasImageImport,
  type ChosenImage,
} from './canvasAssets.js';
import { CanvasCommandError } from './canvasError.js';
import { kitImageImportSchema } from './kitAssets.js';
import type { OwnedAsset } from './protocol.js';

export interface CanvasImages {
  secret: string;
  importImage: (request: CanvasImageImport) => Promise<OwnedAsset>;
  importKitImage: (request: ChosenImage) => Promise<OwnedAsset>;
}

/** Main's route for an image the user chose, into a canvas or into the kit store. */
export function serveCanvasImageImport(
  req: IncomingMessage,
  res: ServerResponse,
  images: CanvasImages | undefined,
): boolean {
  if (req.url !== '/canvas/import-image' && req.url !== '/canvas/import-kit-image') return false;
  if (!images || req.headers['x-canvas-secret'] !== images.secret) {
    res.writeHead(401).end('unauthorized');
    return true;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed');
    return true;
  }
  const intoKit = req.url === '/canvas/import-kit-image';

  void (async () => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 8192) throw new Error('request too large');
        chunks.push(bytes);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const asset = intoKit
        ? await images.importKitImage(parsed(kitImageImportSchema.safeParse(body)))
        : await images.importImage(parsed(canvasImageImportSchema.safeParse(body)));
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

function parsed<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new Error('invalid image import request');
  return result.data;
}
