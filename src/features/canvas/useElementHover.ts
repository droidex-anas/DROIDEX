// The element under the pointer while Edit or Design is on. The preview under
// the pointer is asked once per animation frame with one question in flight, so
// the outline keeps up with the pointer without queueing behind it; leaving
// the frame, or the mode, clears it, and a late answer from before then is dropped.
// A design whose preview run changes is asked again where the pointer was, so
// no outline outlives the run that drew it. The layers panel asks the same way
// for the element under its pointer, by that element's path instead of a point.
//
// The answer is kept in an OverlayStore, read only by what draws it, so a
// pointer sweeping a design renders the outline and not the board.

import { useLayoutEffect, useState } from 'react';
import type { Point } from './canvasGeometry';
import { OverlayStore } from './overlayStore';
import type { PreviewHover, PreviewNode } from './previewDocument';
import type { ElementRef } from './protocol';

export interface HoveredElement {
  designId: string;
  element: PreviewHover;
}

/** Whether the pointer is over the element Edit has picked. */
export function isPicked(picked: ElementRef, hovered: HoveredElement): boolean {
  return (
    picked.designId === hovered.designId &&
    picked.elementId === hovered.element.elementId &&
    picked.instancePath === hovered.element.instancePath
  );
}

/** A point in a design's pixels, or one element in it named by its path. */
type HoverTarget = Point | PreviewNode;

/** Asks one design's live preview what is under a point in its pixels, or where a named element is. */
export type HoverQuestion = (designId: string, at: HoverTarget) => Promise<PreviewHover | null>;

export function useElementHover(active: boolean, ask: HoverQuestion) {
  const [hover] = useState(() => {
    const hovered = new OverlayStore<HoveredElement | null>(null);
    let question = ask;
    let wanted: { designId: string; at: HoverTarget } | null = null;
    let asked: { designId: string; at: HoverTarget } | null = null;
    let asking = false;
    let frame: number | null = null;
    // Bumped by every clear and changed run, so an answer from before it is dropped.
    let generation = 0;

    // An answer that draws what is already drawn renders nothing.
    const show = (next: HoveredElement | null) => {
      const current = hovered.read();
      if (next && current && sameHover(next, current)) return;
      hovered.set(next);
    };
    const askNext = () => {
      const next = wanted;
      if (next === null || asking) return;
      wanted = null;
      asked = next;
      asking = true;
      const askedIn = generation;
      void question(next.designId, next.at).then((element) => {
        asking = false;
        if (askedIn === generation) show(element && { designId: next.designId, element });
        askNext();
      });
    };
    const move = (designId: string, at: HoverTarget) => {
      wanted = { designId, at };
      frame ??= requestAnimationFrame(() => {
        frame = null;
        askNext();
      });
    };
    return {
      hovered,
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
        hovered.set(null);
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

  // Turning hovering on or off, or leaving the board, drops the hover and any
  // question for it, before the change paints.
  useLayoutEffect(() => hover.clear, [active, hover]);

  return {
    /** What is under the pointer while hovering is on; subscribe to draw it. */
    hovered: hover.hovered,
    move: hover.move,
    clear: hover.clear,
    rerun: hover.rerun,
  };
}

function sameHover(a: HoveredElement, b: HoveredElement): boolean {
  const { element: left } = a;
  const { element: right } = b;
  return (
    a.designId === b.designId &&
    left.elementId === right.elementId &&
    left.instancePath === right.instancePath &&
    left.tagName === right.tagName &&
    left.rect.x === right.rect.x &&
    left.rect.y === right.rect.y &&
    left.rect.width === right.rect.width &&
    left.rect.height === right.rect.height &&
    left.room.above === right.room.above &&
    left.room.below === right.room.below
  );
}
