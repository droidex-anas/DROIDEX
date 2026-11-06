// The element under the pointer while Edit is on. The preview under the
// pointer is asked once per animation frame with one question in flight, so
// the outline keeps up with the pointer without queueing behind it; leaving
// the frame, or Edit, clears it, and a late answer from before then is dropped.
// A design whose preview run changes is asked again where the pointer was, so
// no outline outlives the run that drew it.

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
    let asked: { designId: string; at: Point } | null = null;
    let asking = false;
    let frame: number | null = null;
    // Bumped by every clear and changed run, so an answer from before it is dropped.
    let generation = 0;

    const askNext = () => {
      const next = wanted;
      if (next === null || asking) return;
      wanted = null;
      asked = next;
      asking = true;
      const askedIn = generation;
      void question(next.designId, next.at).then((element) => {
        asking = false;
        if (askedIn === generation) setHovered(element && { designId: next.designId, element });
        askNext();
      });
    };
    const move = (designId: string, at: Point) => {
      wanted = { designId, at };
      frame ??= requestAnimationFrame(() => {
        frame = null;
        askNext();
      });
    };
    return {
      setQuestion: (next: HoverQuestion) => {
        question = next;
      },
      move,
      clear: () => {
        generation += 1;
        wanted = null;
        asked = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        setHovered(null);
      },
      /** A design's preview run attached or went, so what its last one answered no longer holds. */
      rerun: (designId: string) => {
        if (asked?.designId !== designId) return;
        generation += 1;
        if (wanted === null) move(designId, asked.at);
      },
    };
  });
  hover.setQuestion(ask);

  // Turning Edit on or off, or leaving the board, drops the hover and any question for it.
  useEffect(() => hover.clear, [active, hover]);

  return {
    hovered: active ? hovered : null,
    move: hover.move,
    clear: hover.clear,
    rerun: hover.rerun,
  };
}
