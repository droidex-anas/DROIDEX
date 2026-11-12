// The lines a snapped drag lined up on and the spaces it measured, or the
// distances Alt measures under the pointer, drawn in screen space above the
// board's world layer so they stay hairlines at any zoom. They are drawn
// outside React: a held frame's marks change with every move of the hand, and
// both kinds follow the live view.

import { useLayoutEffect, useState } from 'react';
import type { BoardStage } from './boardStage';
import { canvasToScreen, type Viewport } from './canvasGeometry';
import { SIZE_ROOM_PX } from './ElementOutlines';
import type { SnapGap, SnapMarks } from './frameSnap';
import type { HeldFrames } from './heldFrames';
import { distanceLabel } from './measureDistances';

/** Screen pixels a centred distance keeps clear of the line's end ticks. */
const TICK_CLEARANCE_PX = 4;

/** What SnapGuides draws. */
export interface GuideMarks extends SnapMarks {
  /** For Alt's distances, the bottom edge of the box they leave, which its size chip hangs under. */
  sizedBottom?: number;
}

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
    const stopHeld = held.onMarks(draw);
    const stopStage = stage.subscribe(draw);
    return () => {
      stopHeld();
      stopStage();
    };
  }, [held, layer, measured, stage]);
  return <div aria-hidden className="canvas-snap" ref={layer.attach} />;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** One measured space as drawn: its line, and its distance centred on it or beside it. */
export interface PlacedGap {
  line: Box;
  pill: { left: number; top: number };
  beside: boolean;
}

/**
 * Where each guide line and measured space goes on screen, given each
 * distance's size on screen in the order of `marks.gaps`.
 */
export function layOutGuides(
  marks: GuideMarks,
  viewport: Viewport,
  pillSizes: readonly Size[],
): { lines: Box[]; gaps: PlacedGap[] } {
  const { sizedBottom } = marks;
  const chipTop =
    sizedBottom === undefined
      ? null
      : Math.round(canvasToScreen(viewport, { x: 0, y: sizedBottom }).y);
  return {
    // A guide on x is a vertical line at that x, so it runs along y.
    lines: marks.guides.map((guide) =>
      lineBox(guide.axis === 'x' ? 'y' : 'x', guide.from, guide.to, guide.at, viewport),
    ),
    gaps: marks.gaps.map((gap, index) => placeGap(gap, viewport, chipTop, pillSizes[index])),
  };
}

/**
 * A measured space: a line with end ticks, and its distance centred on it, or
 * beside it when the line is too short to hold the distance clear of its ticks.
 * `chipTop` is the screen row a size chip's gap starts on, if one shows.
 */
function placeGap(gap: SnapGap, viewport: Viewport, chipTop: number | null, pill: Size): PlacedGap {
  const line = lineBox(gap.axis, gap.from, gap.to, gap.at, viewport);
  const vertical = gap.axis === 'y';
  // A line down from a sized box runs through its size chip, so its distance starts
  // below the chip. Rows compare in whole screen pixels, as the line is drawn.
  const clearBelow =
    vertical && line.top === chipTop ? line.top + SIZE_ROOM_PX + TICK_CLEARANCE_PX : null;
  const start = vertical ? line.top : line.left;
  const end = start + (vertical ? line.height : line.width);
  const pillLength = vertical ? pill.height : pill.width;
  const free = clearBelow === null ? start : Math.max(start, clearBelow);
  let along = (free + end) / 2;
  if (clearBelow !== null) along = Math.max(along, clearBelow + pillLength / 2);
  return {
    line,
    pill: vertical
      ? { left: line.left + line.width / 2, top: along }
      : { left: along, top: line.top + line.height / 2 },
    beside: end - free < pillLength + 2 * TICK_CLEARANCE_PX,
  };
}

/** A one-pixel line from `from` to `to` along `along`, at `at` across it, in whole screen pixels. */
function lineBox(along: 'x' | 'y', from: number, to: number, at: number, viewport: Viewport): Box {
  const start = canvasToScreen(viewport, along === 'x' ? { x: from, y: at } : { x: at, y: from });
  const end = canvasToScreen(viewport, along === 'x' ? { x: to, y: at } : { x: at, y: to });
  const left = Math.round(start.x);
  const top = Math.round(start.y);
  return {
    left,
    top,
    width: along === 'x' ? Math.round(end.x) - left : 1,
    height: along === 'y' ? Math.round(end.y) - top : 1,
  };
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
      nodes.pill.style.left = `${String(pill.left)}px`;
      nodes.pill.style.top = `${String(pill.top)}px`;
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

function span(className: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  return element;
}

function place(element: HTMLElement, box: Box): void {
  element.style.left = `${String(box.left)}px`;
  element.style.top = `${String(box.top)}px`;
  element.style.width = `${String(box.width)}px`;
  element.style.height = `${String(box.height)}px`;
}
