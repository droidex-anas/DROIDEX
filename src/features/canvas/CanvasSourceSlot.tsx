// The source drawer's place in the Canvas pane: the lower half of the tab while
// it is open, so the board above keeps its layout and its selection. The drawer,
// its editor and the code theme load with the first Source action.

import { lazy, Suspense } from 'react';
import { CanvasClient } from './client';
import { bridge } from '../../lib/bridge';
import type { CanvasFrame, SourceFiles } from './protocol';

const LazySourcePanel = lazy(async () => ({
  default: (await import('./CanvasSourcePanel')).CanvasSourcePanel,
}));

const canvas = new CanvasClient(bridge);

export function CanvasSourceSlot({
  frame,
  canvasId,
  appSessionId,
  onClose,
}: {
  /** The frame the drawer is open on, or null while it is closed. */
  frame: CanvasFrame | null;
  canvasId: string | null;
  appSessionId: string;
  onClose: () => void;
}) {
  if (!frame || canvasId === null) return null;
  return (
    <div className="min-h-0 shrink-0 basis-1/2 px-2 pb-2">
      <Suspense fallback={<div aria-hidden className="h-full rounded-2xl bg-droid-raised" />}>
        <LazySourcePanel
          canvasId={canvasId}
          frame={frame}
          readSource={readSource}
          writeSource={(id, designId, expectedRevisionId, files) =>
            writeSource(id, appSessionId, designId, expectedRevisionId, files)
          }
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}

function readSource(canvasId: string, designId: string, revisionId: string) {
  return canvas.readSource(canvasId, designId, revisionId);
}

/** An explicit Save: one write, one mutation ID, and this drawer's own base. */
function writeSource(
  canvasId: string,
  appSessionId: string,
  designId: string,
  expectedRevisionId: string | null,
  files: SourceFiles,
) {
  return canvas.writeFiles(appSessionId, canvasId, {
    mutationId: crypto.randomUUID(),
    designId,
    expectedRevisionId,
    files,
    deletedPaths: [],
  });
}
