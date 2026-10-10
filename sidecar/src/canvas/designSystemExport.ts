// Export writes one kit version as a folder (spec §10). Like source export it
// is a host action: Electron main chooses the folder and alone holds the token
// for this route, so no renderer or agent command can name a destination.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { canvasError } from './canvasError.js';
import {
  exportDestinationSchema,
  serveExportRequest,
  writeExport,
  type ExportFile,
} from './canvasExport.js';
import { modeTokens } from './designStylesheet.js';
import { readDesignSystem } from './designSystems.js';
import type { DesignSystemVersionRef } from './protocol.js';
import { designSystemVersionRefSchema } from './schema.js';

const exportRequestSchema = z
  .object({
    ref: designSystemVersionRefSchema,
    destinationDirectory: exportDestinationSchema,
  })
  .strict();

/**
 * The kit's own files under `src/`, its examples, its guidance as `DESIGN.md`,
 * and its light and dark tokens as `modes.css` under the kit's `data-mode`
 * selectors, which From CSS reads back.
 */
export async function exportDesignSystem(
  ref: DesignSystemVersionRef,
  destinationDirectory: string,
  signal?: AbortSignal,
): Promise<{ filesWritten: number }> {
  if (!isAbsolute(destinationDirectory))
    throw canvasError('invalid_input', 'Choose an export folder in DROIDEX first.');
  const kit = await readDesignSystem(ref);
  signal?.throwIfAborted();
  const files: ExportFile[] = [
    ...Object.entries(kit.files).map(([path, content]) => ({ path: `src/${path}`, content })),
    ...Object.entries(kit.examples).map(([path, content]) => ({
      path: `examples/${path}`,
      content,
    })),
    { path: 'DESIGN.md', content: kit.guidance },
    { path: 'modes.css', content: `${modeTokens(kit)}\n` },
    {
      path: 'design-system.json',
      content: `${JSON.stringify(
        { id: kit.id, version: kit.version, name: kit.name, provenance: kit.provenance ?? null },
        null,
        2,
      )}\n`,
    },
  ];
  await writeExport(resolve(destinationDirectory), files, signal);
  return { filesWritten: files.length };
}

export function serveDesignSystemExport(
  request: IncomingMessage,
  response: ServerResponse,
  token: string | undefined,
): boolean {
  if (request.url !== '/canvas/design-system-export') return false;
  serveExportRequest(request, response, token, (input, signal) => {
    const parsed = exportRequestSchema.safeParse(input);
    if (!parsed.success) throw canvasError('invalid_input', 'Choose a design system to export.');
    return exportDesignSystem(parsed.data.ref, parsed.data.destinationDirectory, signal);
  });
  return true;
}
