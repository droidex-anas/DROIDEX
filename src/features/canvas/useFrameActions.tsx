// The frame toolbar's actions bound to the chat whose pane shows the canvas,
// and the dialogs its Save to library… and Export image… open.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSessionLive } from '../../hooks/useSessionLive';
import { canvasClient as canvas, variantSets } from './canvasClient';
import { exportableRevision } from './captureCanvasImage';
import { useElementPins } from './elementPins';
import { ExportImageDialog } from './ExportImageDialog';
import type { HistoryClient } from './frameHistory';
import type { FrameActions } from './FrameToolbar';
import type { CanvasFrame, FrameRect, RevisionRef } from './protocol';
import { SaveToLibraryDialog } from './SaveToLibraryDialog';
import { useVariantRequests } from './useVariantRequests';
import { variantSetSource } from './variantSets';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

/** What a dialog acts on, fixed when it opens so a later build cannot retarget it. */
type OpenDialog =
  | { kind: 'save'; revision: RevisionRef; frameName: string }
  | { kind: 'export'; revision: RevisionRef; frameName: string; rect: FrameRect };

export function useFrameActions(
  appSessionId: string,
  canvasId: string,
  /** This chat is attached to the canvas, so the sidecar takes its writes. */
  attached: boolean,
  frames: readonly CanvasFrame[],
): { actions: FrameActions; dialog: ReactNode } {
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const close = useCallback(() => {
    setOpen(null);
  }, []);
  const makeVariants = useVariantRequests(appSessionId, canvasId);
  const picks = useElementPins(appSessionId);
  const agentWorking = useSessionLive(appSessionId);
  // Its identity is the toolbar's history owner, so it changes only with the chat or canvas.
  const history = useMemo(
    (): HistoryClient => ({
      listRevisions: (designId) =>
        canvas.revisions.list(canvasId, designId, { limit: MAX_REVISION_PAGE_SIZE }),
      switchRevision: (input) => canvas.revisions.switchTo(appSessionId, canvasId, input),
    }),
    [appSessionId, canvasId],
  );
  const actions: FrameActions = {
    history,
    canEdit: attached,
    rename: (frame, name) =>
      canvas.renameFrame(appSessionId, canvasId, {
        mutationId: crypto.randomUUID(),
        designId: frame.designId,
        name,
        expectedManifestVersion: frame.manifestVersion,
      }),
    picksIn: (frame) =>
      picks.filter(
        ({ canvasId: pickedOn, element }) =>
          pickedOn === canvasId &&
          element.designId === frame.designId &&
          element.revisionId === frame.revisionId,
      ),
    makeVariants: (frame, choice, picked) =>
      variantSets.make(canvasId, frame.designId, () => makeVariants(frame, choice, picked)),
    variantWork: variantSets.viewOf(canvasId),
    // While the agent works, a variant may be partway to what it was asked to become.
    sourceOf: (frame) => (attached && !agentWorking ? variantSetSource(frames, frame) : null),
    applyVariant: (variant, source) => variantSets.apply(appSessionId, canvasId, variant, source),
    saveToLibrary: (frame) => {
      if (frame.revisionId)
        setOpen({
          kind: 'save',
          revision: { designId: frame.designId, revisionId: frame.revisionId },
          frameName: frame.name,
        });
    },
    exportImage: (frame) => {
      const revision = exportableRevision(frame);
      if (revision) setOpen({ kind: 'export', revision, frameName: frame.name, rect: frame.rect });
    },
  };

  return { actions, dialog: open && dialogFor(canvasId, open, close) };
}

function dialogFor(canvasId: string, open: OpenDialog, onClose: () => void): ReactNode {
  if (open.kind === 'save')
    return (
      <SaveToLibraryDialog
        canvasId={canvasId}
        revision={open.revision}
        frameName={open.frameName}
        onClose={onClose}
      />
    );
  return (
    <ExportImageDialog
      canvasId={canvasId}
      revision={open.revision}
      frameName={open.frameName}
      width={open.rect.width}
      height={open.rect.height}
      onClose={onClose}
    />
  );
}
