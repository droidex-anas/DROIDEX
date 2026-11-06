// The element under the pointer while Edit is on. The preview under the
// pointer is asked once per animation frame with one question in flight, so
// the outline keeps up with the pointer without queueing behind it; leaving
// the frame, or Edit, clears it, and a late answer from before then is dropped.

import { useEffect, useState } from 'react';
import type { Point } from './canvasGeometry';
import type { PreviewHover } from './previewDocument';

export interface HoveredElement {
  designId: string;
  element: PreviewHover;
}

/** Asks one design's live preview what is under a point in its pixels. */
export type HoverQuestion = (designId: string, at: Point) => Promise<PreviewHover | null>;

export function useElementHover(active: boolean, ask: HoverQuestion) {
  const [hovered, setHovered] = useState<HoveredElement | null>(null);
  const [hover] = useState(() => {
    let question = ask;
    let wanted: { designId: string; at: Point } | null = null;
    let asking = false;
    let frame: number | null = null;
    // Bumped by every clear, so an answer to a point asked before it is dropped.
    let generation = 0;

    const askNext = () => {
      const next = wanted;
      if (next === null || asking) return;
      wanted = null;
      asking = true;
      const askedIn = generation;
      void question(next.designId, next.at).then((element) => {
        asking = false;
        if (askedIn !== generation) return;
        setHovered(element && { designId: next.designId, element });
        askNext();
      });
    };
    return {
      setQuestion: (next: HoverQuestion) => {
        question = next;
      },
      move: (designId: string, at: Point) => {
        wanted = { designId, at };
        frame ??= requestAnimationFrame(() => {
          frame = null;
          askNext();
        });
      },
      clear: () => {
        generation += 1;
        wanted = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        setHovered(null);
      },
    };
  });
  hover.setQuestion(ask);

  // Turning Edit on or off, or leaving the board, drops the hover and any question for it.
  useEffect(() => hover.clear, [active, hover]);

  return { hovered: active ? hovered : null, move: hover.move, clear: hover.clear };
}
