// The frame toolbar's actions bound to the chat whose pane shows the canvas,
// and the dialogs its Make variants… and Save to library… open.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { canvasClient as canvas } from './canvasClient';
import { CanvasVariants } from './CanvasVariants';
import { REVISION_PAGE_SIZE, type HistoryClient } from './frameHistory';
import type { FrameActions } from './FrameToolbar';
import type { RevisionRef } from './protocol';
import { SaveToLibraryDialog } from './SaveToLibraryDialog';
import { variantSource, type VariantSource } from './variantRequests';

/** What a dialog acts on, fixed when it opens so a later build cannot retarget it. */
type FrameDialog =
  | { kind: 'save'; revision: RevisionRef; frameName: string }
  | { kind: 'variants'; source: VariantSource };

export function useFrameActions(
  appSessionId: string,
  canvasId: string,
  /** This chat is attached to the canvas, so the sidecar takes its writes. */
  attached: boolean,
): { actions: FrameActions; dialog: ReactNode } {
  const [dialog, setDialog] = useState<FrameDialog | null>(null);
  const close = useCallback(() => {
    setDialog(null);
  }, []);
  // Its identity is the toolbar's history owner, so it changes only with the chat or canvas.
  const history = useMemo(
    (): HistoryClient => ({
      listRevisions: (designId) =>
        canvas.revisions.list(canvasId, designId, { limit: REVISION_PAGE_SIZE }),
      restoreRevision: (input) => canvas.revisions.restore(appSessionId, canvasId, input),
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
    makeVariants: (frame) => {
      const source = variantSource(canvasId, frame);
      if (source) setDialog({ kind: 'variants', source });
    },
    saveToLibrary: (frame) => {
      if (frame.revisionId)
        setDialog({
          kind: 'save',
          revision: { designId: frame.designId, revisionId: frame.revisionId },
          frameName: frame.name,
        });
    },
  };

  if (dialog?.kind === 'save')
    return {
      actions,
      dialog: (
        <SaveToLibraryDialog
          canvasId={canvasId}
          revision={dialog.revision}
          frameName={dialog.frameName}
          onClose={close}
        />
      ),
    };
  if (dialog?.kind === 'variants')
    return {
      actions,
      dialog: <CanvasVariants appSessionId={appSessionId} source={dialog.source} onClose={close} />,
    };
  return { actions, dialog: null };
}
