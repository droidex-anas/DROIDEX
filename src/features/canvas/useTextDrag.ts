// The text a press in Design spans while it is dragged. The design's preview is
// asked about the range from the press to the pointer with one question in
// flight, so the outline keeps up without queueing behind the pointer. A
// release stops the asking and keeps the outline until its pick lands; an
// answer from a run that stopped or changed revision, or from before the
// release, is dropped.

import { useEffect, useState } from 'react';
import type { PreviewTextRange } from './previewDocument';
import type { PreviewRuns } from './previewRuns';
import type { FrameRect } from './protocol';

export interface DraggedText {
  designId: string;
  /** The box the spanned text is drawn in, in the design's own pixels. */
  box: FrameRect;
}

export function useTextDrag(runs: PreviewRuns, active: boolean) {
  const [dragged, setDragged] = useState<DraggedText | null>(null);
  const [drag] = useState(() => {
    let wanted: { designId: string; range: PreviewTextRange } | null = null;
    let asking = false;
    // Bumped by every release and clear, so an answer asked before it is dropped.
    let generation = 0;

    const askNext = () => {
      const next = wanted;
      if (next === null || asking) return;
      wanted = null;
      const held = runs.get(next.designId);
      if (!held) {
        setDragged(null);
        return;
      }
      asking = true;
      const askedIn = generation;
      held.run
        .probe(next.range)
        .then((finding) => {
          const current = runs.get(next.designId);
          const sameRun = current?.run === held.run && current.revisionId === held.revisionId;
          if (askedIn !== generation || !sameRun) return;
          const text = finding?.text;
          setDragged(text?.excerpt.trim() ? { designId: next.designId, box: text.rect } : null);
        })
        .catch((failure: unknown) => {
          console.error('A Design drag could not be answered:', failure);
        })
        .finally(() => {
          asking = false;
          askNext();
        });
    };
    const release = () => {
      generation += 1;
      wanted = null;
    };
    return {
      move: (designId: string, range: PreviewTextRange) => {
        wanted = { designId, range };
        askNext();
      },
      release,
      clear: () => {
        release();
        setDragged(null);
      },
    };
  });

  // Leaving Design, or the board, drops the drag and any question for it.
  useEffect(() => drag.clear, [active, drag]);

  return { dragged: active ? dragged : null, ...drag };
}
