// The board's live previews across renders: which design each frame shows
// (previewLabels.ts) and which frames hold one of the four preview slots
// (previewSlots.ts). Both are retained, so a frame keeps its design while a
// newer revision builds and keeps its slot while it stays in view.

import { useState, type ReactNode } from 'react';
import type { BoardInteraction } from './canvasState';
import { NO_SHOWN_REVISIONS, shownRevisions } from './previewLabels';
import { NO_PREVIEW_SLOTS, reducePreviewSlots } from './previewSlots';
import type { CanvasFrame } from './protocol';

export function useBoardPreviews(
  frames: CanvasFrame[],
  visible: string[],
  interaction: BoardInteraction,
  renderPreview: (frame: CanvasFrame, revisionId: string) => ReactNode,
) {
  const [retainedSlots, setRetainedSlots] = useState(NO_PREVIEW_SLOTS);
  const [retainedShown, setRetainedShown] = useState(NO_SHOWN_REVISIONS);
  // Only a frame with something to show has a document to run.
  const shown = shownRevisions(retainedShown, frames);
  if (shown !== retainedShown) setRetainedShown(shown);
  const slots = reducePreviewSlots(retainedSlots, {
    designIds: frames.filter((frame) => shown.has(frame.designId)).map((frame) => frame.designId),
    visible,
    interacted: interaction.interactedFrameId,
    selected: interaction.selectedFrameIds,
  });
  if (slots !== retainedSlots) setRetainedSlots(slots);

  /** One frame's live preview, or null when it holds no slot. */
  const preview = (frame: CanvasFrame): ReactNode | null => {
    const revisionId = shown.get(frame.designId);
    return revisionId !== undefined && slots.live.includes(frame.designId)
      ? renderPreview(frame, revisionId)
      : null;
  };

  return { shown, released: slots.released, preview };
}
