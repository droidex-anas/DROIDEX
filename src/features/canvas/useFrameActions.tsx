// The frame toolbar's actions bound to the chat whose pane shows the canvas,
// and the dialog its Save to library… opens.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSessionLive } from '../../hooks/useSessionLive';
import { canvasClient as canvas, variantSets } from './canvasClient';
import { useElementPins } from './elementPins';
import type { HistoryClient } from './frameHistory';
import type { FrameActions } from './FrameToolbar';
import type { CanvasFrame, RevisionRef } from './protocol';
import { SaveToLibraryDialog } from './SaveToLibraryDialog';
import { useVariantRequests } from './useVariantRequests';
import { variantSetSource } from './variantSets';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

/** What Save to library… saves, fixed when it opens so a later build cannot retarget it. */
interface Saving {
  revision: RevisionRef;
  frameName: string;
}

export function useFrameActions(
  appSessionId: string,
  canvasId: string,
  /** This chat is attached to the canvas, so the sidecar takes its writes. */
  attached: boolean,
  frames: readonly CanvasFrame[],
): { actions: FrameActions; dialog: ReactNode } {
  const [saving, setSaving] = useState<Saving | null>(null);
  const close = useCallback(() => {
    setSaving(null);
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
        setSaving({
          revision: { designId: frame.designId, revisionId: frame.revisionId },
          frameName: frame.name,
        });
    },
  };

  return {
    actions,
    dialog: saving && (
      <SaveToLibraryDialog
        canvasId={canvasId}
        revision={saving.revision}
        frameName={saving.frameName}
        onClose={close}
      />
    ),
  };
}
