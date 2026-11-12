// The lines a snapped drag lined up on and the spaces it measured, or the
// distances Alt measures under the pointer, drawn in screen space above the
// board's world layer so they stay hairlines at any zoom. They are drawn
// outside React: a held frame's marks change with every move of the hand, and
// both kinds follow the live view.

import { useLayoutEffect, useState } from 'react';
import type { BoardStage } from './boardStage';
import type { Viewport } from './canvasGeometry';
import type { HeldFrames } from './heldFrames';
import { distanceLabel } from './measureDistances';
import { layOutGuides, type Box, type GuideMarks, type Size } from './snapGuideLayout';

/** What the held frames snapped on while a hand holds any, else what Alt measured. */
export function StageSnapGuides({
  held,
  measured,
  stage,
}: {
  held: HeldFrames;
  measured: GuideMarks;
  stage: BoardStage;
}) {
  const [layer] = useState(() => new SnapGuideLayer());
  useLayoutEffect(() => {
    const draw = () => {
      layer.draw(held.readMarks() ?? measured, stage.viewport);
    };
    draw();
    // A distance is measured once a hold, so a font or zoom changed since is read anew.
    const stopHold = held.subscribe(layer.forgetSizes);
    const stopHeld = held.onMarks(draw);
    const stopStage = stage.subscribe(draw);
    return () => {
      stopHold();
      stopHeld();
      stopStage();
    };
  }, [held, layer, measured, stage]);
  return <div aria-hidden className="canvas-snap" ref={layer.attach} />;
}

interface GapNodes {
  line: HTMLElement;
  pill: HTMLElement;
  /** The distance the pill shows, and its size on screen, read once per distance. */
  label: string | null;
  size: Size | null;
}

/** The guides' elements, kept while the marks keep their count so each distance is measured once. */
class SnapGuideLayer {
  private node: HTMLElement | null = null;
  private lines: HTMLElement[] = [];
  private gaps: GapNodes[] = [];

  attach = (node: HTMLElement | null): void => {
    this.node = node;
    this.lines = [];
    this.gaps = [];
  };

  forgetSizes = (): void => {
    for (const nodes of this.gaps) nodes.size = null;
  };

  draw(marks: GuideMarks, viewport: Viewport): void {
    const { node } = this;
    if (!node) return;
    if (this.lines.length !== marks.guides.length || this.gaps.length !== marks.gaps.length)
      this.recount(node, marks);
    if (marks.gaps.length === 0 && marks.guides.length === 0) return;
    marks.gaps.forEach((gap, index) => {
      const nodes = this.gaps[index];
      const label = distanceLabel(gap.to - gap.from);
      nodes.line.dataset.axis = gap.axis;
      nodes.pill.dataset.axis = gap.axis;
      if (nodes.label === label) return;
      nodes.pill.textContent = label;
      nodes.label = label;
      nodes.size = null;
    });
    // Read after every write, so a draw lays the page out at most once, and only for a new distance.
    for (const nodes of this.gaps)
      nodes.size ??= { width: nodes.pill.offsetWidth, height: nodes.pill.offsetHeight };
    const laidOut = layOutGuides(
      marks,
      viewport,
      this.gaps.map(({ size }) => size ?? { width: 0, height: 0 }),
    );
    laidOut.lines.forEach((box, index) => {
      place(this.lines[index], box);
    });
    laidOut.gaps.forEach(({ line, pill, beside }, index) => {
      const nodes = this.gaps[index];
      place(nodes.line, line);
      // By translate, so the pill's own centring transform still applies.
      nodes.pill.style.translate = wholePixels(pill.left, pill.top);
      nodes.pill.toggleAttribute('data-beside', beside);
    });
  }

  /** Keeps the elements already drawn, lines before spaces, each space's pill after its line. */
  private recount(node: HTMLElement, marks: GuideMarks): void {
    this.lines = marks.guides.map((_, index) => this.lines.at(index) ?? span('canvas-snap-line'));
    this.gaps = marks.gaps.map(
      (_, index) =>
        this.gaps.at(index) ?? {
          line: span('canvas-snap-gap'),
          pill: span('canvas-snap-pill'),
          label: null,
          size: null,
        },
    );
    node.replaceChildren(...this.lines, ...this.gaps.flatMap(({ line, pill }) => [line, pill]));
  }
}

/** A translate to whole pixels, as left and top were laid out, so a 1px line is not smeared across two. */
function wholePixels(left: number, top: number): string {
  return `${String(Math.round(left))}px ${String(Math.round(top))}px`;
}

function span(className: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  return element;
}

function place(element: HTMLElement, box: Box): void {
  element.style.translate = wholePixels(box.left, box.top);
  element.style.width = `${String(box.width)}px`;
  element.style.height = `${String(box.height)}px`;
}
