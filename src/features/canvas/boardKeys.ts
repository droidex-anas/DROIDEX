// What a key means on the board: the zoom, mode and annotation tool shortcuts, which elements
// keep their own keys, and how focus moves between frames. The board reads
// these; nothing here touches React state.

import type { KeyboardEvent } from 'react';
import type { AnnotationTool } from './annotationGeometry';
import type { ZoomCommand } from './BoardControls';
import type { PlacedFrame } from './canvasGeometry';
import type { BoardMode } from './canvasState';

/** The zoom keys a design tool uses: + and −, and ⇧1, ⇧2 and ⇧0. */
export function zoomShortcut(event: KeyboardEvent): ZoomCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  // The shifted digits go by key position first: on some layouts ⇧1 types +.
  if (event.shiftKey && event.code === 'Digit1') return 'fit';
  if (event.shiftKey && event.code === 'Digit2') return 'selection';
  if (event.shiftKey && event.code === 'Digit0') return 'actual';
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-' || event.key === '_') return 'out';
  return null;
}

/** V for Select and I for Interact, as the rail's tips say. */
export function modeShortcut(event: KeyboardEvent): BoardMode | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'v' || event.key === 'V') return 'select';
  if (event.key === 'i' || event.key === 'I') return 'interact';
  return null;
}

const ANNOTATION_KEYS = new Map<string, AnnotationTool>([
  ['p', 'draw'],
  ['r', 'rect'],
  ['o', 'ellipse'],
  ['l', 'line'],
  ['a', 'arrow'],
  ['t', 'text'],
  ['n', 'note'],
]);

/** A letter per annotation tool, as the rail's tips say. */
export function annotationShortcut(event: KeyboardEvent): AnnotationTool | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  return ANNOTATION_KEYS.get(event.key.toLowerCase()) ?? null;
}

/** The frame whose name label this is, or null for anything else. */
export function frameHeaderOf(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement) || target.dataset.frameHeader === undefined) return null;
  return target.closest<HTMLElement>('[data-design-frame]')?.dataset.designFrame ?? null;
}

export function isBoardControl(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.closest('[data-board-controls]') !== null;
}

export function isBoardEditor(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="textbox"]') !== null)
  );
}

/**
 * The frames as a reader meets them: rows from the top, each read left to right.
 * A frame joins a row when its top sits within the first frame's height of that
 * row's top, so a slightly lower neighbour is not read after the next row.
 */
export function readingOrder(frames: readonly PlacedFrame[]): string[] {
  const byTop = [...frames].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const rows: PlacedFrame[][] = [];
  for (const frame of byTop) {
    const row = rows.at(-1);
    const lead = row?.[0];
    if (row && lead && frame.rect.y < lead.rect.y + lead.rect.height / 2) row.push(frame);
    else rows.push([frame]);
  }
  return rows.flatMap((row) =>
    [...row].sort((a, b) => a.rect.x - b.rect.x).map((frame) => frame.designId),
  );
}

/**
 * Where a key moves focus from the frame `from`, in reading order: the arrows
 * one frame back or on, Home and End to either end. Null for any other key,
 * and for an arrow with a modifier, which nudges instead.
 */
export function frameStep(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  order: readonly string[],
  from: string,
): string | null {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  const at = order.indexOf(from);
  if (at < 0 || order.length === 0) return null;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return order[Math.min(at + 1, order.length - 1)];
    case 'ArrowLeft':
    case 'ArrowUp':
      return order[Math.max(at - 1, 0)];
    case 'Home':
      return order[0];
    case 'End':
      return order[order.length - 1];
    default:
      return null;
  }
}
