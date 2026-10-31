// The source panel's place in the Canvas pane: a column at the pane's right
// while it is open, so the board beside it keeps its frames and its selection
// and only gives up width. The panel, its editor and the code theme load with
// the first Source action.

import { lazy, Suspense, useMemo } from 'react';
import { canvasClient as canvas } from './canvasClient';
import type { HistoryClient } from './frameHistory';
import type { CanvasFrame } from './protocol';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

const LazySourcePanel = lazy(async () => ({
  default: (await import('./CanvasSourcePanel')).CanvasSourcePanel,
}));

export function CanvasSourceSlot({
  frame,
  canvasId,
  appSessionId,
  onClose,
}: {
  /** The frame the panel is open on, or null while it is closed. */
  frame: CanvasFrame | null;
  canvasId: string | null;
  appSessionId: string;
  onClose: () => void;
}) {
  const history = useMemo(
    (): HistoryClient | null =>
      canvasId === null
        ? null
        : {
            listRevisions: (designId) =>
              canvas.revisions.list(canvasId, designId, { limit: MAX_REVISION_PAGE_SIZE }),
            switchRevision: (input) => canvas.revisions.switchTo(appSessionId, canvasId, input),
          },
    [appSessionId, canvasId],
  );
  if (!frame || canvasId === null || history === null) return null;
  return (
    <div className="flex min-h-0 w-2/5 min-w-80 max-w-2xl shrink-0 py-2 pr-2">
      <Suspense fallback={<div aria-hidden className="h-full w-full rounded-xl bg-surface" />}>
        <LazySourcePanel
          canvasId={canvasId}
          frame={frame}
          readSource={readSource}
          // An explicit Save, sent exactly as the panel submitted it: the
          // mutation identity belongs to the write, not to this call, so a retry
          // of an uncertain Save reaches the sidecar's ledger as the same write.
          writeSource={(id, write) => canvas.source.write(appSessionId, id, write)}
          history={history}
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}

function readSource(canvasId: string, designId: string, revisionId: string) {
  return canvas.source.read(canvasId, designId, revisionId);
}
